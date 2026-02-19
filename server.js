import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import http from 'http';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// ES modules fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import routes - FIXED PATH (relative to server.js location)
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import riderRoutes from './routes/riderRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import pricingRoutes from './routes/pricingRoutes.js';

// Import middleware
import errorHandler from './middleware/errorHandler.js';

const app = express();
const server = http.createServer(app);

// Socket.IO setup for Rapido-style real-time communication
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173", process.env.FRONTEND_URL, "https://pariyatan.com", "https://www.pariyatan.com"].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'], // Try polling first
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true
});

// Store socket connections
const userSockets = new Map();
const riderSockets = new Map();

io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id, 'Total connections:', io.sockets.sockets.size);

  // User joins their room
  socket.on('join-user', async (userId) => {
    const roomName = `user-${userId}`;
    socket.join(roomName);
    userSockets.set(userId, socket.id);
    console.log(`✅ User ${userId} joined room: ${roomName} with socket ${socket.id}`);
  });

  // Rider joins their room
  socket.on('join-rider', async (riderId) => {
    const roomName = `rider-${riderId}`;
    socket.join(roomName);
    socket.join('riders'); // Join general riders room
    riderSockets.set(riderId, socket.id);
    console.log(`✅ Rider ${riderId} joined rooms: [${roomName}, riders] with socket ${socket.id}`);
    
    // Update rider's socketId in database
    try {
      const Rider = (await import('./models/Rider.js')).default;
      await Rider.findByIdAndUpdate(riderId, { 
        socketId: socket.id,
        lastSocketConnection: new Date()
      });
      console.log(`✅ Updated rider ${riderId} socketId in database`);
    } catch (error) {
      console.error('❌ Error updating rider socketId:', error);
    }
  });

  // Rider location updates (for tracking)
  socket.on('rider-location', async (data) => {
    try {
      const { riderId, location, bookingId } = data;
      
      // Update rider's location in database
      const Rider = (await import('./models/Rider.js')).default;
      await Rider.findByIdAndUpdate(riderId, {
        currentLocation: {
          type: 'Point',
          coordinates: [location.lng, location.lat]
        }
      });

      // If rider has a current booking, notify the user
      if (bookingId) {
        const Booking = (await import('./models/Booking.js')).default;
        const booking = await Booking.findById(bookingId);
        
        if (booking && booking.userId) {
          io.to(`user-${booking.userId}`).emit('rider-location-update', {
            riderId,
            location,
            bookingId
          });
        }
      }
    } catch (error) {
      console.error('Error handling rider location:', error);
    }
  });

  // User tracking request
  socket.on('track-rider', (data) => {
    const { riderId, userId } = data;
    socket.join(`track-${riderId}-${userId}`);
  });

  // Handle broadcast booking request (from booking controller)
  socket.on('broadcast-booking', (data) => {
    const { riderIds, bookingData } = data;
    
    riderIds.forEach(riderId => {
      io.to(`rider-${riderId}`).emit('new-booking-request', bookingData);
    });
  });

  // Handle booking acceptance (from rider controller)
  socket.on('booking-accepted', async (data) => {
    try {
      const { bookingId, riderId, userId } = data;
      
      // Notify user
      io.to(`user-${userId}`).emit('rider-assigned', {
        bookingId,
        riderId
      });
      
      // Notify other riders that booking is taken
      const Booking = (await import('./models/Booking.js')).default;
      const booking = await Booking.findById(bookingId);
      
      if (booking && booking.broadcastedTo) {
        booking.broadcastedTo.forEach(broadcastedRiderId => {
          if (broadcastedRiderId.toString() !== riderId.toString()) {
            io.to(`rider-${broadcastedRiderId}`).emit('booking-taken', {
              bookingId
            });
          }
        });
      }
    } catch (error) {
      console.error('Error handling booking acceptance:', error);
    }
  });

  // Handle trip status updates
  socket.on('trip-status-update', (data) => {
    const { bookingId, userId, status, riderId } = data;
    
    // Notify user
    io.to(`user-${userId}`).emit('trip-status-changed', {
      bookingId,
      status,
      riderId
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    
    // Remove from user sockets
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        console.log(`❌ Removed user ${userId} from socket map`);
        break;
      }
    }
    
    // Remove from rider sockets
    for (const [riderId, socketId] of riderSockets.entries()) {
      if (socketId === socket.id) {
        riderSockets.delete(riderId);
        console.log(`❌ Removed rider ${riderId} from socket map`);
        // Update rider's socketId in database
        mongoose.model('Rider').findByIdAndUpdate(riderId, { 
          socketId: null,
          lastSocketDisconnection: new Date()
        }).catch(console.error);
        break;
      }
    }
  });
});

// Make io accessible to routes
app.set('io', io);
app.set('userSockets', userSockets);
app.set('riderSockets', riderSockets);

// Debug endpoint to check connected sockets
app.get('/api/debug/sockets', (req, res) => {
  const connectedSockets = [];
  io.sockets.sockets.forEach((socket, id) => {
    connectedSockets.push({
      id,
      rooms: Array.from(socket.rooms)
    });
  });
  
  res.json({
    success: true,
    data: {
      totalConnections: io.sockets.sockets.size,
      userSockets: Object.fromEntries(userSockets),
      riderSockets: Object.fromEntries(riderSockets),
      connectedSockets
    }
  });
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  hidePoweredBy: true
}));

app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "https://pariyatan.com",
    "https://www.pariyatan.com"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Accept']
}));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes - FIXED: All routes are now correctly imported
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/search', searchRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/pricing', pricingRoutes );

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`
  });
});

// Error handling middleware
app.use(errorHandler);

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      autoIndex: true
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};


// Start server
const PORT = process.env.PORT || 5001;
const startServer = async () => {
  try {
    await connectDB();
    
    // Create default admin if not exists
    await createDefaultAdmin();
    
    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ Socket.IO server ready for Rapido-style booking`);
      console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✅ Socket debug endpoint: http://localhost:${PORT}/api/debug/sockets`);
      
      // Log all registered routes
      console.log('\n📋 Registered Routes:');
      console.log('  POST   /api/auth/register');
      console.log('  POST   /api/auth/login');
      console.log('  GET    /api/auth/me');
      console.log('  POST   /api/bookings');
      console.log('  GET    /api/bookings/:id');
      console.log('  POST   /api/bookings/calculate-fare');
      console.log('  GET    /api/bookings/nearby-cabs');
      console.log('  POST   /api/riders/bookings/:id/accept');
      console.log('  POST   /api/payments/cash');
      console.log('  GET    /api/debug/sockets (Debug)');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Create default admin
const createDefaultAdmin = async () => {
  try {
    const Admin = (await import('./models/Admin.js')).default;
    const bcrypt = (await import('bcryptjs')).default;
    
    const adminExists = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
    
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await Admin.create({
        email: process.env.ADMIN_EMAIL,
        password: hashedPassword,
        role: 'ADMIN'
      });
      console.log('✅ Default admin created');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
};

startServer();

export { io, userSockets, riderSockets };