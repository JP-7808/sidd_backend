import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Send email
 * @param {Object} options - Email options
 * @returns {Promise} Send result
 */
export const sendEmail = async (options) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, '')
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

/**
 * Send OTP email
 * @param {string} email - Recipient email
 * @param {string} otp - OTP code
 * @returns {Promise} Send result
 */
export const sendOTPEmail = async (email, otp) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Email Verification</h2>
      <p>Your OTP for email verification is:</p>
      <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
        ${otp}
      </div>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #999; font-size: 12px;">This is an automated message, please do not reply.</p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: 'OTP Verification - Cab Booking',
    html
  });
};

/**
 * Send booking confirmation email
 * @param {Object} booking - Booking details
 * @param {Object} user - User details
 * @returns {Promise} Send result
 */
export const sendBookingConfirmation = async (booking, user) => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Booking Confirmed! 🎉</h2>
      <p>Dear ${user.name},</p>
      <p>Your cab booking has been confirmed. Here are your booking details:</p>
      
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Booking Details</h3>
        <p><strong>Booking ID:</strong> ${booking._id}</p>
        <p><strong>Pickup:</strong> ${booking.pickup.addressText}</p>
        <p><strong>Destination:</strong> ${booking.drop.addressText}</p>
        <p><strong>Distance:</strong> ${booking.distanceKm.toFixed(2)} km</p>
        <p><strong>Estimated Fare:</strong> ₹${booking.estimatedFare}</p>
        <p><strong>Booking Type:</strong> ${booking.bookingType}</p>
        <p><strong>Status:</strong> ${booking.bookingStatus}</p>
      </div>
      
      <p>Your driver will contact you soon. Thank you for choosing our service!</p>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #999; font-size: 12px;">This is an automated message, please do not reply.</p>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: `Booking Confirmed - ${booking._id}`,
    html
  });
};