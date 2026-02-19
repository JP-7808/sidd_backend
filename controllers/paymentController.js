// controllers/paymentController.js
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import UserWallet from '../models/UserWallet.js';
import Notification from '../models/Notification.js';
import {
  createRazorpayOrder,
  verifyPaymentSignature,
  fetchPaymentDetails,
  refundPayment
} from '../config/razorpay.js';
import mongoose from 'mongoose';

// @desc    Create Razorpay order
// @route   POST /api/payments/create-order
// @access  Private
export const createOrder = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const userId = req.user._id;

    // Validate booking
    const booking = await Booking.findOne({
      _id: bookingId,
      userId
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if payment already exists
    const existingPayment = await Payment.findOne({
      bookingId,
      paymentStatus: { $in: ['SUCCESS', 'PENDING'] }
    });

    if (existingPayment && existingPayment.paymentStatus === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed for this booking'
      });
    }

    // Create Razorpay order
    const receipt = `receipt_${bookingId.toString().slice(-8)}`;
    const order = await createRazorpayOrder(
      amount || booking.estimatedFare,
      'INR',
      receipt,
      { bookingId: bookingId.toString(), userId: userId.toString() }
    );

    // Update or create payment record
    let payment = existingPayment;
    if (!payment) {
      payment = new Payment({
        bookingId,
        userId,
        amount: amount || booking.estimatedFare,
        paymentMethod: 'RAZORPAY',
        paymentType: 'FULL',
        paymentStatus: 'PENDING',
        razorpayOrderId: order.id,
        description: `Payment for booking ${bookingId}`
      });
    } else {
      payment.razorpayOrderId = order.id;
      payment.amount = amount || booking.estimatedFare;
    }

    await payment.save();

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: process.env.RAZORPAY_KEY_ID,
        paymentId: payment._id
      }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment order'
    });
  }
};

// @desc    Verify Razorpay payment
// @route   POST /api/payments/verify
// @access  Private
export const verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      bookingId
    } = req.body;

    // Find payment
    const payment = await Payment.findOne({
      bookingId,
      razorpayOrderId
    }).session(session);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Verify signature
    const isValid = verifyPaymentSignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    if (!isValid) {
      payment.paymentStatus = 'FAILED';
      await payment.save({ session });
      
      await session.commitTransaction();
      
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // Fetch payment details from Razorpay
    const paymentDetails = await fetchPaymentDetails(razorpayPaymentId);

    // Update payment
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.paymentStatus = 'SUCCESS';
    payment.metadata = {
      ...payment.metadata,
      razorpayResponse: paymentDetails
    };
    await payment.save({ session });

    // Update booking payment status
    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      {
        paymentStatus: 'PAID',
        bookingStatus: payment.amount === booking.estimatedFare 
          ? 'SEARCHING_DRIVER' 
          : booking.bookingStatus
      },
      { session, new: true }
    );

    // If payment is via wallet, update wallet balance
    if (payment.paymentMethod === 'WALLET') {
      const wallet = await UserWallet.findOne({ userId: payment.userId }).session(session);
      if (wallet) {
        wallet.balance -= payment.amount;
        wallet.transactions.push({
          type: 'DEBIT',
          amount: payment.amount,
          description: `Payment for booking ${bookingId}`,
          referenceId: bookingId,
          referenceModel: 'Booking'
        });
        await wallet.save({ session });
      }
    }

    // Create notification
    const notification = new Notification({
      userId: payment.userId,
      bookingId,
      type: 'PAYMENT_SUCCESS',
      title: 'Payment Successful',
      message: `Payment of ₹${payment.amount} completed successfully`,
      data: {
        bookingId,
        paymentId: payment._id,
        amount: payment.amount
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: {
        payment,
        booking
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Process cash payment
// @route   POST /api/payments/cash
// @access  Private
export const processCashPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;
    const userId = req.user._id;

    // Find booking
    const booking = await Booking.findOne({
      _id: bookingId,
      userId
    }).session(session);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if payment method is cash
    if (booking.paymentMethod !== 'CASH') {
      return res.status(400).json({
        success: false,
        message: 'This booking does not use cash payment'
      });
    }

    // Create payment record
    const payment = new Payment({
      bookingId,
      userId,
      amount: booking.estimatedFare,
      paymentMethod: 'CASH',
      paymentType: 'FULL',
      paymentStatus: 'PENDING', // Will be completed after trip
      description: `Cash payment for booking ${bookingId}`
    });
    await payment.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Cash payment recorded',
      data: payment
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Cash payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing cash payment'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Process wallet payment
// @route   POST /api/payments/wallet
// @access  Private
export const processWalletPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;
    const userId = req.user._id;

    // Find booking
    const booking = await Booking.findOne({
      _id: bookingId,
      userId
    }).session(session);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if payment method is wallet
    if (booking.paymentMethod !== 'WALLET') {
      return res.status(400).json({
        success: false,
        message: 'This booking does not use wallet payment'
      });
    }

    // Get user wallet
    const wallet = await UserWallet.findOne({ userId }).session(session);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found'
      });
    }

    // Check sufficient balance
    if (wallet.balance < booking.estimatedFare) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance',
        data: {
          required: booking.estimatedFare,
          available: wallet.balance
        }
      });
    }

    // Create payment record
    const payment = new Payment({
      bookingId,
      userId,
      amount: booking.estimatedFare,
      paymentMethod: 'WALLET',
      paymentType: 'FULL',
      paymentStatus: 'SUCCESS',
      description: `Wallet payment for booking ${bookingId}`
    });
    await payment.save({ session });

    // Update wallet balance
    wallet.balance -= booking.estimatedFare;
    wallet.transactions.push({
      type: 'DEBIT',
      amount: booking.estimatedFare,
      description: `Payment for booking ${bookingId}`,
      referenceId: bookingId,
      referenceModel: 'Booking'
    });
    await wallet.save({ session });

    // Update booking payment status
    booking.paymentStatus = 'PAID';
    booking.bookingStatus = 'SEARCHING_DRIVER';
    await booking.save({ session });

    // Create notification
    const notification = new Notification({
      userId,
      bookingId,
      type: 'PAYMENT_SUCCESS',
      title: 'Payment Successful',
      message: `Payment of ₹${booking.estimatedFare} completed via wallet`,
      data: {
        bookingId,
        amount: booking.estimatedFare
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Wallet payment successful',
      data: {
        payment,
        walletBalance: wallet.balance
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Wallet payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing wallet payment'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get payment details
// @route   GET /api/payments/:id
// @access  Private
export const getPaymentDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const payment = await Payment.findById(id)
      .populate('bookingId', 'pickup drop distanceKm estimatedFare bookingStatus')
      .populate('userId', 'name email phone');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check authorization
    if (payment.userId._id.toString() !== userId.toString() && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this payment'
      });
    }

    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment details'
    });
  }
};

// @desc    Get user payments
// @route   GET /api/payments/user/my-payments
// @access  Private (User)
export const getUserPayments = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const payments = await Payment.find({ userId })
      .populate('bookingId', 'pickup drop distanceKm bookingStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments({ userId });

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get user payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments'
    });
  }
};

// @desc    Process refund
// @route   POST /api/payments/:id/refund
// @access  Private (Admin)
export const processRefund = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { amount, reason } = req.body;
    const adminId = req.user._id;

    // Find payment
    const payment = await Payment.findById(id).session(session);

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if refundable
    if (payment.paymentStatus !== 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Only successful payments can be refunded'
      });
    }

    if (payment.refundAmount >= payment.amount) {
      return res.status(400).json({
        success: false,
        message: 'Payment already fully refunded'
      });
    }

    const refundAmount = amount || (payment.amount - payment.refundAmount);

    // Process refund via Razorpay
    if (payment.paymentMethod === 'RAZORPAY' && payment.razorpayPaymentId) {
      const refund = await refundPayment(
        payment.razorpayPaymentId,
        refundAmount,
        { reason, initiatedBy: adminId.toString() }
      );

      payment.metadata.refundDetails = refund;
    }

    // Update payment
    payment.refundAmount += refundAmount;
    payment.refundReason = reason;
    payment.refundedAt = new Date();
    
    if (payment.refundAmount >= payment.amount) {
      payment.paymentStatus = 'REFUNDED';
    } else {
      payment.paymentStatus = 'PARTIALLY_REFUNDED';
    }
    
    await payment.save({ session });

    // If refund is for a cancelled booking, update booking
    const booking = await Booking.findById(payment.bookingId).session(session);
    if (booking && booking.bookingStatus === 'CANCELLED') {
      // Add to user wallet if needed
      const wallet = await UserWallet.findOne({ userId: payment.userId }).session(session);
      if (wallet) {
        wallet.balance += refundAmount;
        wallet.transactions.push({
          type: 'CREDIT',
          amount: refundAmount,
          description: `Refund for cancelled booking ${booking._id}`,
          referenceId: booking._id,
          referenceModel: 'Booking'
        });
        await wallet.save({ session });
      }
    }

    // Create notification
    const notification = new Notification({
      userId: payment.userId,
      bookingId: payment.bookingId,
      type: 'REFUND_PROCESSED',
      title: 'Refund Processed',
      message: `Refund of ₹${refundAmount} has been processed${reason ? ` for: ${reason}` : ''}`,
      data: {
        paymentId: payment._id,
        refundAmount,
        reason
      }
    });
    await notification.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: payment
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Process refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing refund'
    });
  } finally {
    session.endSession();
  }
};

// @desc    Get payment statistics
// @route   GET /api/payments/admin/stats
// @access  Private (Admin)
export const getPaymentStats = async (req, res) => {
  try {
    const stats = await Payment.aggregate([
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalRefund: { $sum: '$refundAmount' }
        }
      }
    ]);

    const totalPayments = await Payment.countDocuments();
    const totalRevenue = await Payment.aggregate([
      { $match: { paymentStatus: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayPayments = await Payment.countDocuments({
      createdAt: { $gte: today }
    });

    const todayRevenue = await Payment.aggregate([
      {
        $match: {
          paymentStatus: 'SUCCESS',
          createdAt: { $gte: today }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalPayments,
          totalRevenue: totalRevenue[0]?.total || 0,
          todayPayments,
          todayRevenue: todayRevenue[0]?.total || 0
        },
        breakdown: stats
      }
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment statistics'
    });
  }
};

// @desc    Webhook handler for Razorpay
// @route   POST /webhook/razorpay
// @access  Public
export const razorpayWebhook = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature (implement if needed)
    // const isValid = verifyWebhookSignature(req.body, signature, webhookSecret);
    // if (!isValid) {
    //   return res.status(400).json({ success: false });
    // }

    const event = req.body;

    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity, session);
        break;
        
      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity, session);
        break;
        
      case 'refund.created':
      case 'refund.processed':
        await handleRefundProcessed(event.payload.refund.entity, session);
        break;
        
      default:
        console.log(`Unhandled webhook event: ${event.event}`);
    }

    await session.commitTransaction();

    res.json({ success: true });
  } catch (error) {
    await session.abortTransaction();
    console.error('Webhook error:', error);
    res.status(500).json({ success: false });
  } finally {
    session.endSession();
  }
};

// Helper functions for webhook handling
const handlePaymentCaptured = async (paymentEntity, session) => {
  const payment = await Payment.findOne({
    razorpayOrderId: paymentEntity.order_id
  }).session(session);

  if (payment && payment.paymentStatus !== 'SUCCESS') {
    payment.razorpayPaymentId = paymentEntity.id;
    payment.paymentStatus = 'SUCCESS';
    payment.metadata.razorpayResponse = paymentEntity;
    await payment.save({ session });

    // Update booking
    const booking = await Booking.findById(payment.bookingId).session(session);
    if (booking) {
      booking.paymentStatus = 'PAID';
      if (booking.bookingStatus === 'INITIATED') {
        booking.bookingStatus = 'SEARCHING_DRIVER';
      }
      await booking.save({ session });
    }
  }
};

const handlePaymentFailed = async (paymentEntity, session) => {
  const payment = await Payment.findOne({
    razorpayOrderId: paymentEntity.order_id
  }).session(session);

  if (payment) {
    payment.paymentStatus = 'FAILED';
    payment.metadata.errorDetails = paymentEntity.error_description;
    await payment.save({ session });

    // Create notification
    const notification = new Notification({
      userId: payment.userId,
      bookingId: payment.bookingId,
      type: 'PAYMENT_FAILED',
      title: 'Payment Failed',
      message: `Payment failed: ${paymentEntity.error_description || 'Please try again'}`,
      data: { paymentId: payment._id }
    });
    await notification.save({ session });
  }
};

const handleRefundProcessed = async (refundEntity, session) => {
  const payment = await Payment.findOne({
    razorpayPaymentId: refundEntity.payment_id
  }).session(session);

  if (payment) {
    payment.refundAmount += refundEntity.amount / 100; // Convert from paise
    payment.refundedAt = new Date();
    
    if (payment.refundAmount >= payment.amount) {
      payment.paymentStatus = 'REFUNDED';
    } else {
      payment.paymentStatus = 'PARTIALLY_REFUNDED';
    }
    
    await payment.save({ session });
  }
};