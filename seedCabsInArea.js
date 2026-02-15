import mongoose from 'mongoose';
import Rider from './models/Rider.js';
import Cab from './models/Cab.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// DEFAULT LOCATION - Change these to your area!
const DEFAULT_AREA = {
  city: 'New Delhi',
  lat: 28.6139,  // Change this to your latitude
  lng: 77.2090   // Change this to your longitude
};

const seedCabsInArea = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Create test rider for the area if doesn't exist
    const riderEmail = `rider.${Date.now()}@test.com`;
    const riderPhone = `98765${Math.floor(Math.random() * 100000)}`;
    
    let rider = await Rider.findOne({ email: riderEmail });
    
    if (!rider) {
      rider = await Rider.create({
        name: `Test Rider - ${DEFAULT_AREA.city}`,
        email: riderEmail,
        phone: riderPhone,
        password: await bcrypt.hash('password123', 10),
        photo: 'https://avatar.placeholder.com/rider.jpg',
        aadhaarNumber: `AAD${Date.now()}`,
        drivingLicenseNumber: `DL${Date.now()}`,
        homeAddress: {
          addressLine: `Main Street, ${DEFAULT_AREA.city}`,
          city: DEFAULT_AREA.city,
          state: DEFAULT_AREA.city,
          pincode: '110001',
          location: {
            lat: DEFAULT_AREA.lat,
            lng: DEFAULT_AREA.lng
          }
        },
        isEmailVerified: true,
        isPhoneVerified: true,
        isKYCVerified: true,
        status: 'APPROVED'
      });
      console.log(`✅ Created rider: ${rider.name}`);
    }

    // Create 3 cabs in the area
    const cabTypes = ['SEDAN', 'HATCHBACK', 'SUV'];
    const cabModels = [
      'Honda City 2023',
      'Maruti Swift 2023',
      'Mahindra EUV500 2023'
    ];
    const cabNumbers = [
      `${DEFAULT_AREA.city.substring(0, 2).toUpperCase()}01AB${Math.floor(2000 + Math.random() * 8000)}`,
      `${DEFAULT_AREA.city.substring(0, 2).toUpperCase()}01AB${Math.floor(2000 + Math.random() * 8000)}`,
      `${DEFAULT_AREA.city.substring(0, 2).toUpperCase()}01AB${Math.floor(2000 + Math.random() * 8000)}`
    ];

    const newCabs = [];
    for (let i = 0; i < 3; i++) {
      const cab = await Cab.create({
        riderId: rider._id,
        cabType: cabTypes[i],
        cabNumber: cabNumbers[i],
        cabModel: cabModels[i],
        yearOfManufacture: 2023,
        seatingCapacity: i === 2 ? 7 : 5,
        acAvailable: true,
        isApproved: true,
        isAvailable: true,
        approvalStatus: 'APPROVED',
        approvedAt: new Date()
      });
      newCabs.push(cab);
      console.log(`✅ Created cab: ${cab.cabType} - ${cab.cabNumber}`);
    }

    console.log('\n📍 Cabs Added Summary:');
    console.log(`Location: ${DEFAULT_AREA.city}`);
    console.log(`Coordinates: ${DEFAULT_AREA.lat}, ${DEFAULT_AREA.lng}`);
    console.log(`Total Cabs: ${newCabs.length}`);
    console.log('\nCabs Details:');
    newCabs.forEach((cab, idx) => {
      console.log(`${idx + 1}. ${cab.cabType} - ${cab.cabNumber}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

seedCabsInArea();
