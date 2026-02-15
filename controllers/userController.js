import User from '../models/User.js';
import UserAddress from '../models/UserAddress.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import Rating from '../models/Rating.js';
import Rider from '../models/Rider.js';
import { calculateDistance } from '../utils/helper.js';

// Get user profile
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password -otp -otpExpires -tokenVersion -resetPasswordToken -resetPasswordExpires');
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
};

// Update user profile
export const updateUserProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const user = req.user;

    if (name) user.name = name;
    if (phone) {
      // Check if phone is already taken by another user
      const existingUser = await User.findOne({ 
        phone, 
        _id: { $ne: user._id } 
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }
      user.phone = phone;
    }

    await user.save();

    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.otp;
    delete userResponse.otpExpires;
    delete userResponse.tokenVersion;

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

// Add user address
export const addUserAddress = async (req, res) => {
  try {
    const {
      label,
      title,
      addressLine,
      landmark,
      city,
      state,
      pincode,
      location,
      contactName,
      contactPhone,
      isDefault
    } = req.body;

    const userId = req.user._id;

    // If setting as default, remove default from other addresses
    if (isDefault) {
      await UserAddress.updateMany(
        { userId, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    const address = await UserAddress.create({
      userId,
      label,
      title,
      addressLine,
      landmark,
      city,
      state,
      pincode,
      location,
      contactName,
      contactPhone,
      isDefault: isDefault || false
    });

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: address
    });
  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add address'
    });
  }
};

// Get user addresses
export const getUserAddresses = async (req, res) => {
  try {
    const userId = req.user._id;
    const addresses = await UserAddress.find({ userId, isActive: true })
      .sort({ isDefault: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: addresses
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get addresses'
    });
  }
};

// Update user address
export const updateUserAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updateData = req.body;

    // Check if address exists and belongs to user
    const address = await UserAddress.findOne({ _id: id, userId });
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // If setting as default, remove default from other addresses
    if (updateData.isDefault === true) {
      await UserAddress.updateMany(
        { userId, _id: { $ne: id }, isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    Object.assign(address, updateData);
    await address.save();

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: address
    });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update address'
    });
  }
};

// Delete user address
export const deleteUserAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const address = await UserAddress.findOne({ _id: id, userId });
    
    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // Soft delete
    address.isActive = false;
    await address.save();

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete address'
    });
  }
};

// Get user bookings
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId };
    if (status) {
      query.bookingStatus = status;
    }

    const bookings = await Booking.find(query)
      .populate('riderId', 'name phone photo cabNumber')
      .populate('cabId', 'cabType cabModel')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get user bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bookings'
    });
  }
};

// Get booking details
export const getBookingDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const booking = await Booking.findOne({ _id: id, userId })
      .populate('riderId', 'name phone photo rating totalRatings')
      .populate('cabId', 'cabType cabModel cabNumber')
      .populate('pickup.addressId')
      .populate('drop.addressId');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Get payment details
    const payment = await Payment.findOne({ bookingId: id, userId });

    // Get notifications for this booking
    const notifications = await Notification.find({ 
      userId, 
      bookingId: id 
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        booking,
        payment,
        notifications
      }
    });
  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get booking details'
    });
  }
};

// Cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { reason } = req.body;

    const booking = await Booking.findOne({ 
      _id: id, 
      userId,
      bookingStatus: { $in: ['PENDING', 'ACCEPTED', 'RIDER_ASSIGNED'] }
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or cannot be cancelled'
      });
    }

    // Calculate cancellation charge based on timing
    let cancellationCharge = 0;
    const now = new Date();
    
    if (booking.bookingType === 'IMMEDIATE' && booking.acceptedAt) {
      const timeSinceAcceptance = (now - booking.acceptedAt) / (1000 * 60); // minutes
      if (timeSinceAcceptance < 5) {
        cancellationCharge = booking.estimatedFare * 0.1; // 10% charge
      } else {
        cancellationCharge = booking.estimatedFare * 0.2; // 20% charge
      }
    }

    // Update booking
    booking.bookingStatus = 'CANCELLED';
    booking.cancelledBy = 'USER';
    booking.cancellationReason = reason;
    booking.cancellationCharge = cancellationCharge;
    await booking.save();

    // Refund if payment was made
    if (booking.paidAmount > 0) {
      const refundAmount = booking.paidAmount - cancellationCharge;
      if (refundAmount > 0) {
        // Process refund through Razorpay
        // This would require Razorpay API integration
      }
    }

    // Notify rider if assigned
    if (booking.riderId) {
      const io = req.app.get('io');
      io.to(booking.riderId.toString()).emit('booking-cancelled', {
        bookingId: booking._id,
        reason
      });

      // Create notification for rider
      await Notification.create({
        riderId: booking.riderId,
        bookingId: booking._id,
        type: 'BOOKING_CANCELLED',
        title: 'Booking Cancelled',
        message: `User cancelled booking #${booking._id}`,
        data: { reason }
      });
    }

    // Create notification for user
    await Notification.create({
      userId,
      bookingId: booking._id,
      type: 'BOOKING_CANCELLED',
      title: 'Booking Cancelled',
      message: `Your booking #${booking._id} has been cancelled`,
      data: { 
        cancellationCharge,
        refundAmount: booking.paidAmount - cancellationCharge
      }
    });

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        cancellationCharge,
        refundAmount: booking.paidAmount - cancellationCharge
      }
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
};

// Rate rider
export const rateRider = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user._id;

    // Check if booking exists and is completed
    const booking = await Booking.findOne({
      _id: bookingId,
      userId,
      bookingStatus: 'COMPLETED'
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not completed'
      });
    }

    // Check if already rated
    const existingRating = await Rating.findOne({ bookingId, userId });
    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this ride'
      });
    }

    // Create rating
    const newRating = await Rating.create({
      bookingId,
      userId,
      riderId: booking.riderId,
      rating,
      comment
    });

    // Update rider's overall rating
    const rider = await Rider.findById(booking.riderId);
    const totalRatings = rider.totalRatings + 1;
    const newOverallRating = (
      (rider.overallRating * rider.totalRatings) + rating
    ) / totalRatings;

    rider.overallRating = parseFloat(newOverallRating.toFixed(1));
    rider.totalRatings = totalRatings;
    await rider.save();

    res.status(201).json({
      success: true,
      message: 'Rating submitted successfully',
      data: newRating
    });
  } catch (error) {
    console.error('Rate rider error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit rating'
    });
  }
};

// Get user notifications
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, unreadOnly } = req.query;

    const query = { userId };
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .populate('bookingId', 'bookingStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ 
      userId, 
      isRead: false 
    });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notifications'
    });
  }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOne({ _id: id, userId });
    
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
};

// Update notification token (for push notifications)
export const updateNotificationToken = async (req, res) => {
  try {
    const { notificationToken } = req.body;
    const userId = req.user._id;

    await User.findByIdAndUpdate(userId, { 
      notificationToken 
    });

    res.status(200).json({
      success: true,
      message: 'Notification token updated'
    });
  } catch (error) {
    console.error('Update notification token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification token'
    });
  }
};