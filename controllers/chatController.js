import ChatMessage from '../models/ChatMessage.js';
import Booking from '../models/Booking.js';

// Send message
export const sendMessage = async (req, res) => {
  try {
    const { bookingId, message, receiverType } = req.body;
    const senderId = req.user._id;
    const senderType = req.user.role === 'USER' ? 'CUSTOMER' : 'RIDER';

    // Validate booking exists and user is part of it
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user is part of this booking
    const isCustomer = booking.userId.toString() === senderId.toString();
    const isRider = booking.riderId && booking.riderId.toString() === senderId.toString();
    
    if (!isCustomer && !isRider) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Determine receiver
    let receiverId;
    if (senderType === 'CUSTOMER') {
      receiverId = booking.riderId;
    } else {
      receiverId = booking.userId;
    }

    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Create message
    const chatMessage = await ChatMessage.create({
      bookingId,
      senderId,
      senderType,
      receiverId,
      receiverType,
      message: message.trim()
    });

    // Populate sender info
    await chatMessage.populate('senderId', 'name photo');

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: chatMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
};

// Get messages for a booking
export const getMessages = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;

    // Validate booking exists and user is part of it
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user is part of this booking
    const isCustomer = booking.userId.toString() === userId.toString();
    const isRider = booking.riderId && booking.riderId.toString() === userId.toString();
    
    if (!isCustomer && !isRider) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get messages
    const messages = await ChatMessage.find({ bookingId })
      .populate('senderId', 'name photo')
      .sort({ createdAt: 1 });

    res.status(200).json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages'
    });
  }
};

// Mark messages as read
export const markAsRead = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;

    // Update unread messages
    await ChatMessage.updateMany(
      {
        bookingId,
        receiverId: userId,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    res.status(200).json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
};

// Get unread count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const unreadCount = await ChatMessage.countDocuments({
      receiverId: userId,
      isRead: false
    });

    res.status(200).json({
      success: true,
      data: { unreadCount }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count'
    });
  }
};