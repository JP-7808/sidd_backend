// seedEmailTemplates.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const defaultTemplates = [
  {
    templateName: "OTP_VERIFICATION",
    subject: "Verify Your Email - Cab Booking",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Email Verification</h2>
        <p>Hi {{name}},</p>
        <p>Your verification code is:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0;">
          {{otp}}
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `,
    variables: ["name", "otp"],
    isActive: true
  },
  {
    templateName: "BOOKING_CONFIRMATION_USER",
    subject: "Booking Confirmed - {{bookingId}}",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Booking Confirmed! 🎉</h2>
        <p>Hi {{userName}},</p>
        <p>Your cab booking has been confirmed. Here are your booking details:</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Booking Details</h3>
          <p><strong>Booking ID:</strong> {{bookingId}}</p>
          <p><strong>Pickup:</strong> {{pickupAddress}}</p>
          <p><strong>Destination:</strong> {{dropAddress}}</p>
          <p><strong>Distance:</strong> {{distance}} km</p>
          <p><strong>Estimated Fare:</strong> ₹{{estimatedFare}}</p>
          <p><strong>Booking Type:</strong> {{bookingType}}</p>
          <p><strong>Trip Type:</strong> {{tripType}}</p>
          {{#if isRoundTrip}}
          <p><strong>Return Time:</strong> {{returnTime}}</p>
          {{/if}}
        </div>
        
        <p>Your driver will contact you soon. Thank you for choosing our service!</p>
      </div>
    `,
    variables: ["userName", "bookingId", "pickupAddress", "dropAddress", "distance", "estimatedFare", "bookingType", "tripType", "isRoundTrip", "returnTime"],
    isActive: true
  },
  {
    templateName: "BOOKING_REQUEST_RIDER",
    subject: "New Ride Request - {{bookingId}}",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">New Ride Request 🚗</h2>
        <p>Hi {{riderName}},</p>
        <p>You have a new ride request. Details:</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Ride Details</h3>
          <p><strong>From:</strong> {{pickupAddress}}</p>
          <p><strong>To:</strong> {{dropAddress}}</p>
          <p><strong>Distance:</strong> {{distance}} km</p>
          <p><strong>Estimated Fare:</strong> ₹{{estimatedFare}}</p>
          <p><strong>Trip Type:</strong> {{tripType}}</p>
          <p><strong>Response Deadline:</strong> {{deadline}}</p>
        </div>
        
        <p>Please respond within {{responseTime}} minutes.</p>
      </div>
    `,
    variables: ["riderName", "bookingId", "pickupAddress", "dropAddress", "distance", "estimatedFare", "tripType", "deadline", "responseTime"],
    isActive: true
  },
  {
    templateName: "RIDER_APPROVED",
    subject: "Rider Account Approved 🎉",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Account Approved!</h2>
        <p>Dear {{riderName}},</p>
        <p>We are pleased to inform you that your rider account has been approved.</p>
        <p>You can now login to the rider app and start accepting rides.</p>
        <p>Welcome to our platform!</p>
        
        <div style="margin-top: 30px; padding: 20px; background-color: #f5f5f5; border-radius: 5px;">
          <h3>Next Steps:</h3>
          <ol>
            <li>Download the rider app</li>
            <li>Login with your credentials</li>
            <li>Complete your profile</li>
            <li>Go online and start accepting rides</li>
          </ol>
        </div>
      </div>
    `,
    variables: ["riderName"],
    isActive: true
  },
  {
    templateName: "PAYMENT_SUCCESS",
    subject: "Payment Successful - ₹{{amount}}",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Payment Successful ✅</h2>
        <p>Hi {{userName}},</p>
        <p>Your payment of ₹{{amount}} has been processed successfully.</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Payment Details</h3>
          <p><strong>Amount:</strong> ₹{{amount}}</p>
          <p><strong>Payment Method:</strong> {{paymentMethod}}</p>
          <p><strong>Transaction ID:</strong> {{transactionId}}</p>
          <p><strong>Booking ID:</strong> {{bookingId}}</p>
          <p><strong>Date:</strong> {{date}}</p>
        </div>
        
        <p>Thank you for your payment!</p>
      </div>
    `,
    variables: ["userName", "amount", "paymentMethod", "transactionId", "bookingId", "date"],
    isActive: true
  },
  {
    templateName: "RIDE_COMPLETED",
    subject: "Ride Completed - {{bookingId}}",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Ride Completed 🏁</h2>
        <p>Hi {{userName}},</p>
        <p>Your ride has been completed successfully.</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Ride Summary</h3>
          <p><strong>Booking ID:</strong> {{bookingId}}</p>
          <p><strong>Driver:</strong> {{driverName}}</p>
          <p><strong>Cab:</strong> {{cabDetails}}</p>
          <p><strong>Distance:</strong> {{distance}} km</p>
          <p><strong>Duration:</strong> {{duration}} minutes</p>
          <p><strong>Final Fare:</strong> ₹{{finalFare}}</p>
          {{#if isRoundTrip}}
          <p><strong>Trip Type:</strong> Round Trip</p>
          <p><strong>Return Ride Status:</strong> {{returnStatus}}</p>
          {{/if}}
        </div>
        
        <p>Please rate your driver to help us improve our service.</p>
      </div>
    `,
    variables: ["userName", "bookingId", "driverName", "cabDetails", "distance", "duration", "finalFare", "isRoundTrip", "returnStatus"],
    isActive: true
  },
  {
    templateName: "ROUND_TRIP_SCHEDULED",
    subject: "Return Ride Scheduled - {{bookingId}}",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Return Ride Scheduled 🔄</h2>
        <p>Hi {{userName}},</p>
        <p>Your return ride has been scheduled.</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Return Ride Details</h3>
          <p><strong>Booking ID:</strong> {{bookingId}}</p>
          <p><strong>Pickup Time:</strong> {{returnTime}}</p>
          <p><strong>Pickup Location:</strong> {{returnPickup}}</p>
          <p><strong>Drop Location:</strong> {{returnDrop}}</p>
          <p><strong>Driver:</strong> {{driverName}}</p>
          <p><strong>Cab:</strong> {{cabDetails}}</p>
          <p><strong>Estimated Return Fare:</strong> ₹{{returnFare}}</p>
        </div>
        
        <p>Your driver will arrive at the scheduled time. Please be ready.</p>
      </div>
    `,
    variables: ["userName", "bookingId", "returnTime", "returnPickup", "returnDrop", "driverName", "cabDetails", "returnFare"],
    isActive: true
  },
  {
    templateName: "RETURN_RIDE_REMINDER",
    subject: "Reminder: Return Ride in {{timeLeft}}",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Return Ride Reminder ⏰</h2>
        <p>Hi {{userName}},</p>
        <p>This is a reminder for your scheduled return ride.</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Return Ride Details</h3>
          <p><strong>Scheduled Time:</strong> {{scheduledTime}}</p>
          <p><strong>Time Left:</strong> {{timeLeft}}</p>
          <p><strong>Pickup:</strong> {{pickupLocation}}</p>
          <p><strong>Drop:</strong> {{dropLocation}}</p>
          <p><strong>Driver:</strong> {{driverName}}</p>
          <p><strong>Contact:</strong> {{driverPhone}}</p>
        </div>
        
        <p>Please be ready at the pickup location on time.</p>
      </div>
    `,
    variables: ["userName", "scheduledTime", "timeLeft", "pickupLocation", "dropLocation", "driverName", "driverPhone"],
    isActive: true
  },
  {
    templateName: "PASSWORD_RESET",
    subject: "Password Reset Request",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Password Reset</h2>
        <p>Hi {{name}},</p>
        <p>You requested to reset your password. Click the button below to reset:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{resetLink}}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-size: 16px; display: inline-block;">
            Reset Password
          </a>
        </div>
        
        <p>This link will expire in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `,
    variables: ["name", "resetLink"],
    isActive: true
  },
  {
    templateName: "WELCOME_USER",
    subject: "Welcome to Cab Booking! 🎉",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Welcome to Cab Booking!</h2>
        <p>Hi {{name}},</p>
        <p>Thank you for joining our cab booking platform!</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Get Started:</h3>
          <ol>
            <li>Complete your profile</li>
            <li>Add your frequently used addresses</li>
            <li>Book your first ride</li>
            <li>Enjoy safe and comfortable rides</li>
          </ol>
        </div>
        
        <p>We're excited to have you on board!</p>
      </div>
    `,
    variables: ["name"],
    isActive: true
  },
  {
    templateName: "WELCOME_RIDER",
    subject: "Welcome Rider! 🚗",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">Welcome to Cab Booking Rider Platform!</h2>
        <p>Hi {{name}},</p>
        <p>Thank you for joining our rider community!</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Next Steps:</h3>
          <ol>
            <li>Complete your KYC verification</li>
            <li>Upload your cab documents</li>
            <li>Wait for admin approval</li>
            <li>Start accepting rides and earn money!</li>
          </ol>
        </div>
        
        <p>We're excited to have you on board!</p>
      </div>
    `,
    variables: ["name"],
    isActive: true
  }
];

async function seedEmailTemplates() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Import EmailTemplate model
    const EmailTemplate = (await import('./models/EmailTemplate.js')).default;

    // Check if templates already exist
    const existingCount = await EmailTemplate.countDocuments();
    
    if (existingCount === 0) {
      console.log('Seeding email templates...');
      
      // Insert all templates
      await EmailTemplate.insertMany(defaultTemplates);
      
      console.log(`✅ Successfully seeded ${defaultTemplates.length} email templates`);
    } else {
      console.log(`✅ Email templates already exist (${existingCount} templates)`);
      
      // Update existing templates or add missing ones
      for (const template of defaultTemplates) {
        const existing = await EmailTemplate.findOne({ templateName: template.templateName });
        
        if (!existing) {
          await EmailTemplate.create(template);
          console.log(`✅ Added missing template: ${template.templateName}`);
        } else {
          // Update if needed
          await EmailTemplate.updateOne(
            { templateName: template.templateName },
            { $set: template }
          );
          console.log(`✅ Updated template: ${template.templateName}`);
        }
      }
    }

    // List all templates
    const allTemplates = await EmailTemplate.find({}, 'templateName subject isActive');
    console.log('\n📧 Available Email Templates:');
    allTemplates.forEach(template => {
      console.log(`  • ${template.templateName} - ${template.subject} (${template.isActive ? 'Active' : 'Inactive'})`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Seed completed successfully!');
    
  } catch (error) {
    console.error('❌ Error seeding email templates:', error);
    process.exit(1);
  }
}

// Run the seed function
seedEmailTemplates();