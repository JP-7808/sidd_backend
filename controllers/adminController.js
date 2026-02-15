import User from '../models/User.js';
import Rider from '../models/Rider.js';
import Cab from '../models/Cab.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Pricing from '../models/Pricing.js';
import RiderEarning from '../models/RiderEarning.js';
import Notification from '../models/Notification.js';
import EmailTemplate from '../models/EmailTemplate.js';
import Rating from '../models/Rating.js'; 
import { sendEmail } from '../utils/emailService.js';

// Admin Dashboard Stats
export const getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // User stats
    const totalUsers = await User.countDocuments();
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: startOfToday }
    });
    const activeUsers = await User.countDocuments({ isActive: true });

    // Rider stats
    const totalRiders = await Rider.countDocuments();
    const pendingRiders = await Rider.countDocuments({ approvalStatus: 'PENDING' });
    const approvedRiders = await Rider.countDocuments({ approvalStatus: 'APPROVED' });
    const onlineRiders = await Rider.countDocuments({ isOnline: true });

    // Booking stats
    const totalBookings = await Booking.countDocuments();
    const todayBookings = await Booking.countDocuments({
      createdAt: { $gte: startOfToday }
    });
    const weeklyBookings = await Booking.countDocuments({
      createdAt: { $gte: startOfWeek }
    });
    const monthlyBookings = await Booking.countDocuments({
      createdAt: { $gte: startOfMonth }
    });

    // Revenue stats
    const payments = await Payment.aggregate([
      {
        $match: {
          paymentStatus: 'SUCCESS',
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
          totalRefunds: { $sum: "$refundAmount" }
        }
      }
    ]);

    const commission = await RiderEarning.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalCommission: { $sum: "$adminCommission" }
        }
      }
    ]);

    // Recent activities
    const recentBookings = await Booking.find()
      .populate('userId', 'name')
      .populate('riderId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    const recentPayments = await Payment.find()
      .populate('userId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        stats: {
          users: {
            total: totalUsers,
            newToday: newUsersToday,
            active: activeUsers
          },
          riders: {
            total: totalRiders,
            pending: pendingRiders,
            approved: approvedRiders,
            online: onlineRiders
          },
          bookings: {
            total: totalBookings,
            today: todayBookings,
            week: weeklyBookings,
            month: monthlyBookings
          },
          revenue: {
            total: payments[0]?.totalRevenue || 0,
            net: (payments[0]?.totalRevenue || 0) - (payments[0]?.totalRefunds || 0),
            commission: commission[0]?.totalCommission || 0
          }
        },
        recent: {
          bookings: recentBookings,
          payments: recentPayments
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard stats'
    });
  }
};

// Manage Riders
export const getRiders = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;

    const match = {};

    if (status) match.approvalStatus = status;

    if (search) {
      match.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const riders = await Rider.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * Number(limit) },
      { $limit: Number(limit) },

      // JOIN with Cab
      {
        $lookup: {
          from: 'cabs',
          localField: '_id',
          foreignField: 'riderId',
          as: 'cab'
        }
      },
      {
        $unwind: {
          path: '$cab',
          preserveNullAndEmptyArrays: true
        }
      },

      // Remove sensitive fields
      {
        $project: {
          password: 0,
          tokenVersion: 0
        }
      }
    ]);

    const total = await Rider.countDocuments(match);

    res.status(200).json({
      success: true,
      data: {
        riders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get riders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get riders'
    });
  }
};


export const getRiderDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const rider = await Rider.findById(id)
      .select('-password -tokenVersion');
    
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    // Get cab details
    const cab = await Cab.findOne({ riderId: id });
    
    // Get earnings summary
    const earnings = await RiderEarning.aggregate([
      { $match: { riderId: rider._id } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$riderEarning" },
          totalCommission: { $sum: "$adminCommission" },
          totalRides: { $sum: 1 },
          pendingPayout: {
            $sum: {
              $cond: [{ $eq: ["$payoutStatus", "PENDING"] }, "$riderEarning", 0]
            }
          }
        }
      }
    ]);

    // Get recent bookings
    const recentBookings = await Booking.find({ riderId: id })
      .populate('userId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get ratings
    const ratings = await Rating.find({ riderId: id })
      .populate('userId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        rider,
        cab,
        earnings: earnings[0] || {
          totalEarnings: 0,
          totalCommission: 0,
          totalRides: 0,
          pendingPayout: 0
        },
        recentBookings,
        ratings
      }
    });
  } catch (error) {
    console.error('Get rider details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get rider details'
    });
  }
};

export const approveRider = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // action: 'APPROVE' or 'REJECT'

    const rider = await Rider.findById(id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    if (action === 'APPROVE') {
      rider.approvalStatus = 'APPROVED';
      rider.approvedAt = new Date();
      
      // Approve cab as well
      await Cab.findOneAndUpdate(
        { riderId: id },
        { 
          approvalStatus: 'APPROVED',
          isApproved: true,
          approvedAt: new Date()
        }
      );

      // Send approval email
      await sendEmail({
        to: rider.email,
        subject: 'Rider Account Approved',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Account Approved! 🎉</h2>
            <p>Dear ${rider.name},</p>
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
        `
      });

      // Create notification for rider
      await Notification.create({
        riderId: id,
        type: 'RIDER_APPROVED',
        title: 'Account Approved',
        message: 'Your rider account has been approved',
        data: { approvedAt: new Date() }
      });

    } else if (action === 'REJECT') {
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required'
        });
      }

      rider.approvalStatus = 'REJECTED';
      rider.rejectionReason = reason;

      // Send rejection email
      await sendEmail({
        to: rider.email,
        subject: 'Rider Account Application Update',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Application Update</h2>
            <p>Dear ${rider.name},</p>
            <p>We regret to inform you that your rider application has been rejected.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>If you have any questions or would like to appeal this decision, please contact our support team.</p>
          </div>
        `
      });

      // Create notification for rider
      await Notification.create({
        riderId: id,
        type: 'RIDER_REJECTED',
        title: 'Account Rejected',
        message: 'Your rider account has been rejected',
        data: { reason }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    await rider.save();

    res.status(200).json({
      success: true,
      message: `Rider ${action.toLowerCase()}d successfully`,
      data: rider
    });
  } catch (error) {
    console.error('Approve rider error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process rider approval'
    });
  }
};

export const suspendRider = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const rider = await Rider.findById(id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    rider.approvalStatus = 'SUSPENDED';
    rider.rejectionReason = reason;
    await rider.save();

    // Send suspension email
    await sendEmail({
      to: rider.email,
      subject: 'Account Suspended',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Account Suspended</h2>
          <p>Dear ${rider.name},</p>
          <p>Your rider account has been suspended.</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p>You will not be able to accept new rides until your account is reinstated.</p>
          <p>If you have any questions, please contact our support team.</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: 'Rider suspended successfully',
      data: rider
    });
  } catch (error) {
    console.error('Suspend rider error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to suspend rider'
    });
  }
};

// Manage Cabs
export const getCabs = async (req, res) => {
  try {
    const {
      status,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};
    
    if (status) {
      query.approvalStatus = status;
    }
    
    if (search) {
      query.$or = [
        { cabNumber: { $regex: search, $options: 'i' } },
        { cabModel: { $regex: search, $options: 'i' } }
      ];
    }

    const cabs = await Cab.find(query)
      .populate('riderId', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Cab.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        cabs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get cabs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cabs'
    });
  }
};

export const approveCab = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;

    const cab = await Cab.findById(id);
    if (!cab) {
      return res.status(404).json({
        success: false,
        message: 'Cab not found'
      });
    }

    if (action === 'APPROVE') {
      cab.approvalStatus = 'APPROVED';
      cab.isApproved = true;
      cab.approvedAt = new Date();
    } else if (action === 'REJECT') {
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required'
        });
      }
      cab.approvalStatus = 'REJECTED';
      cab.isApproved = false;
      cab.rejectionReason = reason;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action'
      });
    }

    await cab.save();

    res.status(200).json({
      success: true,
      message: `Cab ${action.toLowerCase()}d successfully`,
      data: cab
    });
  } catch (error) {
    console.error('Approve cab error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process cab approval'
    });
  }
};

// Manage Pricing
export const getPricing = async (req, res) => {
  try {
    const pricing = await Pricing.find().sort({ cabType: 1 });

    res.status(200).json({
      success: true,
      data: pricing
    });
  } catch (error) {
    console.error('Get pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pricing'
    });
  }
};

export const updatePricing = async (req, res) => {
  try {
    const { cabType, pricePerKm, baseFare, adminCommissionPercent } = req.body;

    const pricing = await Pricing.findOneAndUpdate(
      { cabType },
      {
        pricePerKm,
        baseFare,
        adminCommissionPercent,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Pricing updated successfully',
      data: pricing
    });
  } catch (error) {
    console.error('Update pricing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update pricing'
    });
  }
};

// Manage Bookings
export const getBookings = async (req, res) => {
  try {
    const {
      status,
      tripType,
      bookingType,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};
    
    if (status) query.bookingStatus = status;
    if (tripType) query.tripType = tripType;
    if (bookingType) query.bookingType = bookingType;
    
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const bookings = await Booking.find(query)
      .populate('userId', 'name email phone')
      .populate('riderId', 'name phone')
      .populate('cabId', 'cabNumber cabType')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    // Get booking stats
    const stats = await Booking.aggregate([
      {
        $facet: {
          byStatus: [
            { $group: { _id: "$bookingStatus", count: { $sum: 1 } } }
          ],
          byTripType: [
            { $group: { _id: "$tripType", count: { $sum: 1 } } }
          ],
          byBookingType: [
            { $group: { _id: "$bookingType", count: { $sum: 1 } } }
          ],
          revenue: [
            { $match: { finalFare: { $exists: true, $gt: 0 } } },
            { $group: { _id: null, total: { $sum: "$finalFare" } } }
          ]
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        bookings,
        stats: {
          byStatus: stats[0]?.byStatus || [],
          byTripType: stats[0]?.byTripType || [],
          byBookingType: stats[0]?.byBookingType || [],
          totalRevenue: stats[0]?.revenue[0]?.total || 0
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
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bookings'
    });
  }
};

export const getBookingAnalytics = async (req, res) => {
  try {
    const { period = 'month' } = req.query; // day, week, month, year
    let groupByFormat, startDate;

    const now = new Date();
    switch (period) {
      case 'day':
        startDate = new Date(now.setDate(now.getDate() - 30)); // Last 30 days
        groupByFormat = '%Y-%m-%d';
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 90)); // Last 90 days
        groupByFormat = '%Y-%W';
        break;
      case 'month':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1)); // Last year
        groupByFormat = '%Y-%m';
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 5)); // Last 5 years
        groupByFormat = '%Y';
        break;
    }

    // Booking trends
    const trends = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupByFormat, date: "$createdAt" }
          },
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$finalFare", "$estimatedFare"] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Revenue analytics
    const revenue = await Payment.aggregate([
      {
        $match: {
          paymentStatus: 'SUCCESS',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupByFormat, date: "$createdAt" }
          },
          amount: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Top riders
    const topRiders = await RiderEarning.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: "$riderId",
          totalEarnings: { $sum: "$riderEarning" },
          totalRides: { $sum: 1 },
          totalCommission: { $sum: "$adminCommission" }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 }
    ]);

    // Populate rider details
    const riderIds = topRiders.map(r => r._id);
    const riders = await Rider.find({ _id: { $in: riderIds } })
      .select('name email phone');

    const topRidersWithDetails = topRiders.map(earning => {
      const rider = riders.find(r => r._id.toString() === earning._id.toString());
      return {
        ...earning,
        rider: rider || null
      };
    });

    // Cab type distribution
    const cabDistribution = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $lookup: {
          from: 'cabs',
          localField: 'cabId',
          foreignField: '_id',
          as: 'cab'
        }
      },
      { $unwind: { path: '$cab', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ["$cab.cabType", "UNKNOWN"] },
          count: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$finalFare", "$estimatedFare"] } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        trends,
        revenue,
        topRiders: topRidersWithDetails,
        cabDistribution,
        period
      }
    });
  } catch (error) {
    console.error('Get booking analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get booking analytics'
    });
  }
};

// Manage Users
export const getUsers = async (req, res) => {
  try {
    const {
      search,
      isActive,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const users = await User.find(query)
      .select('-password -otp -otpExpires -tokenVersion')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    // Get user stats
    const stats = await User.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          verified: { $sum: { $cond: [{ $eq: ["$isEmailVerified", true] }, 1, 0] } },
          active: { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } },
          googleUsers: { $sum: { $cond: [{ $ifNull: ["$googleId", false] }, 1, 0] } }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: {
        users,
        stats: stats[0] || {
          total: 0,
          verified: 0,
          active: 0,
          googleUsers: 0
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
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
};

export const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = isActive;
    await user.save();

    // Send notification email
    const statusText = isActive ? 'activated' : 'deactivated';
    await sendEmail({
      to: user.email,
      subject: `Account ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Account ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}</h2>
          <p>Dear ${user.name},</p>
          <p>Your account has been ${statusText} by the administrator.</p>
          <p>${isActive ? 'You can now login and use our services.' : 'You will not be able to login until your account is reactivated.'}</p>
          <p>If you have any questions, please contact our support team.</p>
        </div>
      `
    });

    res.status(200).json({
      success: true,
      message: `User account ${statusText} successfully`,
      data: user
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
};

// Manage Payouts
export const getPayouts = async (req, res) => {
  try {
    const {
      status,
      riderId,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};
    
    if (status) query.payoutStatus = status;
    if (riderId) query.riderId = riderId;
    
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const payouts = await RiderEarning.find(query)
      .populate('riderId', 'name email phone')
      .populate('bookingId', 'pickup drop rideEndTime')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await RiderEarning.countDocuments(query);

    // Calculate totals
    const totals = await RiderEarning.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$payoutStatus",
          totalAmount: { $sum: "$riderEarning" },
          count: { $sum: 1 }
        }
      }
    ]);

    const pendingTotal = totals.find(t => t._id === 'PENDING')?.totalAmount || 0;
    const paidTotal = totals.find(t => t._id === 'PAID')?.totalAmount || 0;

    res.status(200).json({
      success: true,
      data: {
        payouts,
        summary: {
          pendingTotal,
          paidTotal,
          totalAmount: pendingTotal + paidTotal
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
    console.error('Get payouts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payouts'
    });
  }
};

export const processPayout = async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionId, notes } = req.body;

    const payout = await RiderEarning.findById(id);
    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    if (payout.payoutStatus === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Payout already processed'
      });
    }

    // Update payout status
    payout.payoutStatus = 'PAID';
    payout.metadata = {
      ...payout.metadata,
      processedAt: new Date(),
      processedBy: req.user._id,
      transactionId,
      notes
    };
    await payout.save();

    // Update rider wallet (deduct paid amount)
    await RiderWallet.findOneAndUpdate(
      { riderId: payout.riderId },
      { $inc: { balance: -payout.riderEarning } }
    );

    // Create notification for rider
    await Notification.create({
      riderId: payout.riderId,
      type: 'PAYOUT_PROCESSED',
      title: 'Payout Processed',
      message: `Payout of ₹${payout.riderEarning} has been processed`,
      data: {
        amount: payout.riderEarning,
        transactionId,
        bookingId: payout.bookingId
      }
    });

    res.status(200).json({
      success: true,
      message: 'Payout processed successfully',
      data: payout
    });
  } catch (error) {
    console.error('Process payout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payout'
    });
  }
};

// Bulk payout processing
export const processBulkPayouts = async (req, res) => {
  try {
    const { riderIds, startDate, endDate } = req.body;

    const query = {
      payoutStatus: 'PENDING',
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    };

    if (riderIds && riderIds.length > 0) {
      query.riderId = { $in: riderIds };
    }

    const pendingPayouts = await RiderEarning.find(query);

    if (pendingPayouts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No pending payouts found'
      });
    }

    // Process each payout
    const processedPayouts = [];
    const errors = [];

    for (const payout of pendingPayouts) {
      try {
        payout.payoutStatus = 'PAID';
        payout.metadata = {
          ...payout.metadata,
          processedAt: new Date(),
          processedBy: req.user._id,
          batchProcessed: true
        };
        await payout.save();

        // Update rider wallet
        await RiderWallet.findOneAndUpdate(
          { riderId: payout.riderId },
          { $inc: { balance: -payout.riderEarning } }
        );

        processedPayouts.push(payout);
      } catch (error) {
        errors.push({
          payoutId: payout._id,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Processed ${processedPayouts.length} payouts`,
      data: {
        processed: processedPayouts.length,
        totalAmount: processedPayouts.reduce((sum, p) => sum + p.riderEarning, 0),
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    console.error('Process bulk payouts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk payouts'
    });
  }
};