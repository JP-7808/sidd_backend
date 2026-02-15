import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import RiderWallet from '../models/RiderWallet.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Notification from '../models/Notification.js';

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create payment order
export const createPaymentOrder = async (req, res) => {
  try {
    const { bookingId, amount, paymentType = 'FULL' } = req.body;
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

    // Validate amount
    if (paymentType === 'FULL' && amount < booking.estimatedFare) {
      return res.status(400).json({
        success: false,
        message: `Minimum payment amount is ₹${booking.estimatedFare}`
      });
    }

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      receipt: `booking_${bookingId}`,
      notes: {
        bookingId: bookingId.toString(),
        userId: userId.toString(),
        paymentType
      }
    });

    // Create payment record
    const payment = await Payment.create({
      bookingId,
      userId,
      razorpayOrderId: razorpayOrder.id,
      amount,
      paymentMethod: 'RAZORPAY',
      paymentType,
      paymentStatus: 'PENDING',
      currency: 'INR',
      description: `Payment for booking #${bookingId}`,
      metadata: {
        razorpayOrder: razorpayOrder
      }
    });

    res.status(200).json({
      success: true,
      data: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount / 100,
        currency: razorpayOrder.currency,
        paymentId: payment._id
      }
    });
  } catch (error) {
    console.error('Create payment order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order'
    });
  }
};

// Verify payment and complete booking
export const verifyPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      paymentId
    } = req.body;

    const userId = req.user._id;

    // Get payment record
    const payment = await Payment.findOne({
      _id: paymentId,
      userId,
      razorpayOrderId: razorpay_order_id
    }).session(session);

    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      payment.paymentStatus = 'FAILED';
      await payment.save({ session });
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    // Update payment record
    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    payment.paymentStatus = 'SUCCESS';
    payment.updatedAt = new Date();
    await payment.save({ session });

    // Update booking - mark as payment done
    const booking = await Booking.findById(payment.bookingId).session(session);
    if (booking) {
      if (!['TRIP_COMPLETED', 'CANCELLED'].includes(booking.bookingStatus)) {
    booking.bookingStatus = 'PAYMENT_DONE';
  }
      booking.paymentStatus = 'PAID';
      await booking.save({ session });
    }

    // Create notification
    await Notification.create([{
      userId,
      bookingId: payment.bookingId,
      type: 'PAYMENT_SUCCESS',
      title: 'Payment Successful',
      message: `Payment of ₹${payment.amount} completed successfully. Booking completed!`,
      data: {
        amount: payment.amount,
        paymentId: payment._id,
        bookingId: payment.bookingId
      }
    }], { session });

    await session.commitTransaction();

    // Notify via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${userId}`).emit('payment-completed', {
        bookingId: payment.bookingId,
        paymentId: payment._id,
        amount: payment.amount,
        status: 'SUCCESS'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment verified and booking completed successfully',
      data: {
        payment,
        booking: {
          id: booking._id,
          status: booking.bookingStatus,
          finalFare: payment.amount
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment'
    });
  } finally {
    session.endSession();
  }
};

// Complete cash payment
export const completeCashPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { bookingId } = req.body;
    const userId = req.user._id;

    // Find booking
    const booking = await Booking.findOne({
      _id: bookingId,
      userId,
      bookingStatus: 'TRIP_COMPLETED',
      paymentMethod: 'CASH'
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not eligible for cash payment'
      });
    }

    // Create cash payment record
    const payment = new Payment({
      bookingId,
      userId,
      amount: booking.finalFare || booking.estimatedFare,
      paymentMethod: 'CASH',
      paymentType: 'FULL',
      paymentStatus: 'SUCCESS',
      currency: 'INR',
      description: `Cash payment for booking #${bookingId}`,
      metadata: {
        paidAt: new Date(),
        confirmedByUser: true
      }
    });

    await payment.save({ session });

    // Update booking status
    booking.bookingStatus = 'PAYMENT_DONE';
    booking.paymentStatus = 'PAID';
    await booking.save({ session });

    // Create notification
    await Notification.create([{
      userId,
      bookingId,
      type: 'PAYMENT_SUCCESS',
      title: 'Cash Payment Confirmed',
      message: `Cash payment of ₹${payment.amount} confirmed. Booking completed!`,
      data: {
        amount: payment.amount,
        paymentMethod: 'CASH',
        bookingId
      }
    }], { session });

    await session.commitTransaction();

    // Notify via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${userId}`).emit('payment-completed', {
        bookingId,
        paymentId: payment._id,
        amount: payment.amount,
        status: 'SUCCESS',
        method: 'CASH'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Cash payment confirmed and booking completed',
      data: {
        payment,
        booking: {
          id: booking._id,
          status: booking.bookingStatus,
          finalFare: payment.amount
        }
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Complete cash payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete cash payment'
    });
  } finally {
    session.endSession();
  }
};

// Get payment details
export const getPaymentDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user._id;

    // Check booking access
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

    // Get payment details
    const payments = await Payment.find({ 
      bookingId,
      userId 
    }).sort({ createdAt: -1 });

    const totalPaid = payments
      .filter(p => p.paymentStatus === 'SUCCESS')
      .reduce((sum, p) => sum + p.amount, 0);

    res.status(200).json({
      success: true,
      data: {
        booking: {
          estimatedFare: booking.estimatedFare,
          paidAmount: booking.paidAmount,
          pendingAmount: booking.pendingAmount,
          finalFare: booking.finalFare,
          paymentType: booking.paymentType
        },
        payments,
        summary: {
          totalPaid,
          totalPending: Math.max(0, booking.estimatedFare - totalPaid),
          totalPayments: payments.length
        }
      }
    });
  } catch (error) {
    console.error('Get payment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment details'
    });
  }
};

// Process cash payment
export const processCashPayment = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const userId = req.user._id;

    // Check if user is rider
    if (req.user.role !== 'RIDER') {
      return res.status(403).json({
        success: false,
        message: 'Only riders can process cash payments'
      });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      riderId: req.user._id,
      bookingStatus: 'COMPLETED',
      paymentType: 'CASH'
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not eligible for cash payment'
      });
    }

    // Validate amount
    if (amount <= 0 || amount > booking.finalFare) {
      return res.status(400).json({
        success: false,
        message: `Invalid amount. Maximum allowed: ₹${booking.finalFare}`
      });
    }

    // Create cash payment record
    const payment = await Payment.create({
      bookingId,
      userId: booking.userId,
      amount,
      paymentMethod: 'CASH',
      paymentType: 'FULL',
      paymentStatus: 'SUCCESS',
      currency: 'INR',
      description: `Cash payment for booking #${bookingId}`,
      metadata: {
        collectedBy: req.user._id,
        collectedAt: new Date()
      }
    });

    // Update booking
    booking.paidAmount += amount;
    booking.pendingAmount = Math.max(0, booking.finalFare - booking.paidAmount);
    await booking.save();

    // Create notification for user
    await Notification.create({
      userId: booking.userId,
      bookingId,
      type: 'PAYMENT_SUCCESS',
      title: 'Cash Payment Received',
      message: `Cash payment of ₹${amount} received for your ride`,
      data: {
        amount,
        bookingId,
        riderName: req.user.name
      }
    });

    res.status(200).json({
      success: true,
      message: 'Cash payment recorded successfully',
      data: payment
    });
  } catch (error) {
    console.error('Process cash payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process cash payment'
    });
  }
};

// Process wallet payment
export const processWalletPayment = async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const userId = req.user._id;

    // Check user wallet (this would be a user wallet, not rider wallet)
    const userWallet = await UserWallet.findOne({ userId });
    if (!userWallet || userWallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      userId,
      bookingStatus: { $in: ['COMPLETED', 'ONGOING'] }
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Validate amount
    const maxAmount = booking.pendingAmount || booking.finalFare || booking.estimatedFare;
    if (amount <= 0 || amount > maxAmount) {
      return res.status(400).json({
        success: false,
        message: `Invalid amount. Maximum allowed: ₹${maxAmount}`
      });
    }

    // Deduct from user wallet
    userWallet.balance -= amount;
    await userWallet.save();

    // Create wallet payment record
    const payment = await Payment.create({
      bookingId,
      userId,
      amount,
      paymentMethod: 'WALLET',
      paymentType: amount >= maxAmount ? 'FULL' : 'PARTIAL',
      paymentStatus: 'SUCCESS',
      currency: 'INR',
      description: `Wallet payment for booking #${bookingId}`,
      metadata: {
        walletBalanceBefore: userWallet.balance + amount,
        walletBalanceAfter: userWallet.balance
      }
    });

    // Update booking
    booking.paidAmount += amount;
    booking.pendingAmount = Math.max(0, maxAmount - booking.paidAmount);
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Wallet payment successful',
      data: {
        payment,
        newWalletBalance: userWallet.balance
      }
    });
  } catch (error) {
    console.error('Process wallet payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process wallet payment'
    });
  }
};

// Initiate refund
export const initiateRefund = async (req, res) => {
  try {
    const { paymentId, refundAmount, reason } = req.body;
    const userId = req.user._id;

    // Check if user is admin
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Only admin can initiate refunds'
      });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Validate refund amount
    if (refundAmount <= 0 || refundAmount > payment.amount) {
      return res.status(400).json({
        success: false,
        message: `Invalid refund amount. Maximum: ₹${payment.amount}`
      });
    }

    // Process refund through Razorpay
    let razorpayRefund;
    if (payment.paymentMethod === 'RAZORPAY' && payment.razorpayPaymentId) {
      try {
        razorpayRefund = await razorpay.payments.refund(
          payment.razorpayPaymentId,
          {
            amount: Math.round(refundAmount * 100),
            notes: {
              reason,
              refundBy: userId.toString()
            }
          }
        );
      } catch (razorpayError) {
        console.error('Razorpay refund error:', razorpayError);
        return res.status(400).json({
          success: false,
          message: 'Failed to process refund through Razorpay'
        });
      }
    }

    // Update payment record
    payment.refundAmount = refundAmount;
    payment.refundReason = reason;
    payment.refundedAt = new Date();
    payment.paymentStatus = refundAmount === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    payment.metadata.refund = razorpayRefund || { manual: true };
    await payment.save();

    // Update booking if needed
    const booking = await Booking.findById(payment.bookingId);
    if (booking) {
      booking.paidAmount -= refundAmount;
      booking.pendingAmount += refundAmount;
      await booking.save();
    }

    // Create notification for user
    await Notification.create({
      userId: payment.userId,
      bookingId: payment.bookingId,
      type: 'PAYMENT_REFUND',
      title: 'Payment Refunded',
      message: `Refund of ₹${refundAmount} processed for your payment`,
      data: {
        refundAmount,
        reason,
        paymentId: payment._id
      }
    });

    res.status(200).json({
      success: true,
      message: 'Refund initiated successfully',
      data: {
        payment,
        refundId: razorpayRefund?.id
      }
    });
  } catch (error) {
    console.error('Initiate refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate refund'
    });
  }
};

// Get payment history
export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      startDate, 
      endDate, 
      status, 
      paymentMethod,
      page = 1, 
      limit = 20 
    } = req.query;

    const query = { userId };
    
    // Date filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Status filter
    if (status) {
      query.paymentStatus = status;
    }
    
    // Payment method filter
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    const payments = await Payment.find(query)
      .populate('bookingId', 'pickup drop bookingStatus')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(query);

    // Calculate totals
    const totals = await Payment.aggregate([
      { $match: query },
      { 
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          totalRefunds: { $sum: "$refundAmount" },
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        payments,
        summary: totals[0] || {
          totalAmount: 0,
          totalRefunds: 0,
          count: 0
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history'
    });
  }
};

// Razorpay webhook handler
export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return res.status(400).send('Invalid signature');
    }

    const event = req.body.event;
    const payload = req.body.payload;

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload.payment.entity);
        break;
      
      case 'payment.failed':
        await handlePaymentFailed(payload.payment.entity);
        break;
      
      case 'refund.created':
        await handleRefundCreated(payload.refund.entity);
        break;
      
      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Webhook error');
  }
};

// Webhook handlers
const handlePaymentCaptured = async (payment) => {
  // Find payment by razorpay payment id
  const existingPayment = await Payment.findOne({
    razorpayPaymentId: payment.id
  });

  if (existingPayment) {
    existingPayment.paymentStatus = 'SUCCESS';
    existingPayment.metadata.webhook = payment;
    await existingPayment.save();

    // Update booking
    const booking = await Booking.findById(existingPayment.bookingId);
    if (booking) {
      booking.paidAmount += existingPayment.amount;
      booking.pendingAmount = Math.max(0, booking.estimatedFare - booking.paidAmount);
      await booking.save();
    }
  }
};

const handlePaymentFailed = async (payment) => {
  const existingPayment = await Payment.findOne({
    razorpayPaymentId: payment.id
  });

  if (existingPayment) {
    existingPayment.paymentStatus = 'FAILED';
    existingPayment.metadata.webhook = payment;
    await existingPayment.save();
  }
};

const handleRefundCreated = async (refund) => {
  const payment = await Payment.findOne({
    razorpayPaymentId: refund.payment_id
  });

  if (payment) {
    payment.refundAmount = refund.amount / 100;
    payment.refundedAt = new Date(refund.created_at * 1000);
    payment.paymentStatus = refund.amount === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    payment.metadata.refund = refund;
    await payment.save();
  }
};