import mongoose from 'mongoose';
import Rider from './models/Rider.js';
import Cab from './models/Cab.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const seedCabs = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing cabs (optional - comment out if you want to keep existing)
    // await Cab.deleteMany({});

    // Create test riders if they don't exist
    const timestamp = Date.now();
    const riders = [
      {
        name: 'Test Rider 1',
        email: `rider1.${timestamp}@test.com`,
        phone: `98765${Math.floor(Math.random() * 100000)}`,
        password: await bcrypt.hash('password123', 10),
        photo: 'https://avatar.placeholder.com/rider1.jpg',
        aadhaarNumber: `AAD${timestamp}001`,
        drivingLicenseNumber: `DL${timestamp}001`,
        homeAddress: {
          addressLine: 'Street 1, Area',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
          location: {
            lat: 28.6139,
            lng: 77.2090
          }
        },
        currentLocation: {
          type: 'Point',
          coordinates: [77.2090, 28.6139]
        },
        isEmailVerified: true,
        isPhoneVerified: true,
        isKYCVerified: true,
        status: 'APPROVED',
        isOnline: true,
        isAvailable: true,
        availabilityStatus: 'AVAILABLE'
      },
      {
        name: 'Test Rider 2',
        email: `rider2.${timestamp}@test.com`,
        phone: `98765${Math.floor(Math.random() * 100000)}`,
        password: await bcrypt.hash('password123', 10),
        photo: 'https://avatar.placeholder.com/rider2.jpg',
        aadhaarNumber: `AAD${timestamp}002`,
        drivingLicenseNumber: `DL${timestamp}002`,
        homeAddress: {
          addressLine: 'Street 2, Area',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110002',
          location: {
            lat: 28.7041,
            lng: 77.1025
          }
        },
        currentLocation: {
          type: 'Point',
          coordinates: [77.1025, 28.7041]
        },
        isEmailVerified: true,
        isPhoneVerified: true,
        isKYCVerified: true,
        status: 'APPROVED',
        isOnline: true,
        isAvailable: true,
        availabilityStatus: 'AVAILABLE'
      },
      {
        name: 'Test Rider 3',
        email: `rider3.${timestamp}@test.com`,
        phone: `98765${Math.floor(Math.random() * 100000)}`,
        password: await bcrypt.hash('password123', 10),
        photo: 'https://avatar.placeholder.com/rider3.jpg',
        aadhaarNumber: `AAD${timestamp}003`,
        drivingLicenseNumber: `DL${timestamp}003`,
        homeAddress: {
          addressLine: 'Street 3, Area',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110003',
          location: {
            lat: 28.5244,
            lng: 77.1855
          }
        },
        currentLocation: {
          type: 'Point',
          coordinates: [77.1855, 28.5244]
        },
        isEmailVerified: true,
        isPhoneVerified: true,
        isKYCVerified: true,
        status: 'APPROVED',
        isOnline: true,
        isAvailable: true,
        availabilityStatus: 'AVAILABLE'
      }
    ];

    const createdRiders = [];
    for (const riderData of riders) {
      const existingRider = await Rider.findOne({ email: riderData.email });
      if (existingRider) {
        console.log(`ℹ️  Rider with email ${riderData.email} already exists`);
        createdRiders.push(existingRider);
      } else {
        const newRider = await Rider.create(riderData);
        console.log(`✅ Created rider: ${newRider.name}`);
        createdRiders.push(newRider);
      }
    }

    // Create test cabs with unique numbers
    const randomNum = Math.floor(Math.random() * 10000);
    const cabsData = [
      {
        riderId: createdRiders[0]._id,
        cabType: 'SEDAN',
        cabNumber: `DL01AB${1001 + randomNum}`,
        cabModel: 'Honda City 2023',
        yearOfManufacture: 2023,
        seatingCapacity: 4,
        acAvailable: true,
        isApproved: true,
        isAvailable: true,
        approvalStatus: 'APPROVED',
        approvedAt: new Date()
      },
      {
        riderId: createdRiders[1]._id,
        cabType: 'HATCHBACK',
        cabNumber: `DL01AB${1002 + randomNum}`,
        cabModel: 'Maruti Swift 2023',
        yearOfManufacture: 2023,
        seatingCapacity: 5,
        acAvailable: true,
        isApproved: true,
        isAvailable: true,
        approvalStatus: 'APPROVED',
        approvedAt: new Date()
      },
      {
        riderId: createdRiders[2]._id,
        cabType: 'SUV',
        cabNumber: `DL01AB${1003 + randomNum}`,
        cabModel: 'Mahindra EUV500 2023',
        yearOfManufacture: 2023,
        seatingCapacity: 7,
        acAvailable: true,
        isApproved: true,
        isAvailable: true,
        approvalStatus: 'APPROVED',
        approvedAt: new Date()
      }
    ];

    // Insert cabs
    const insertedCabs = await Cab.insertMany(cabsData);
    console.log(`✅ Created ${insertedCabs.length} test cabs`);

    console.log('\n📋 Seeded Data Summary:');
    console.log(`- Riders: ${createdRiders.length}`);
    console.log(`- Cabs: ${insertedCabs.length}`);
    console.log('\n🔍 Test Cabs Details:');
    insertedCabs.forEach((cab, idx) => {
      console.log(`${idx + 1}. ${cab.cabType} - ${cab.cabNumber} (${cab.cabModel})`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed cabs error:', error);
    process.exit(1);
  }
};

seedCabs();
