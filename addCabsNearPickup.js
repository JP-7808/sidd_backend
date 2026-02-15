import mongoose from 'mongoose';
import Rider from './models/Rider.js';
import Cab from './models/Cab.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// ⭐ CHANGE THESE TO YOUR PICKUP LOCATION ⭐
const PICKUP_LAT = 28.6139;  // Your latitude from the map
const PICKUP_LNG = 77.2090;  // Your longitude from the map
const SEARCH_RADIUS = 5;     // Search radius in km

console.log(`\n🚗 Adding ${SEARCH_RADIUS}km radius cabs...`);
console.log(`📍 Center: ${PICKUP_LAT}, ${PICKUP_LNG}\n`);

// Generate nearby coordinates (spread within radius)
const generateNearbyLocations = (centerLat, centerLng, radiusKm, count = 3) => {
  const locations = [];
  const kmPerDegree = 111; // Approximate km per degree
  const radiusDegrees = radiusKm / kmPerDegree;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const distance = (radiusKm / count) * (i + 1);
    const distanceDegrees = distance / kmPerDegree;
    
    const lat = centerLat + Math.cos(angle) * distanceDegrees;
    const lng = centerLng + Math.sin(angle) * distanceDegrees;
    
    locations.push({ lat, lng });
  }
  
  return locations;
};

const seedCabsNearPickup = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const locations = generateNearbyLocations(PICKUP_LAT, PICKUP_LNG, SEARCH_RADIUS, 3);
    const cabTypes = ['SEDAN', 'HATCHBACK', 'SUV'];
    const cabModels = ['Honda City 2023', 'Maruti Swift 2023', 'Mahindra EUV500 2023'];

    const createdCabs = [];

    for (let i = 0; i < 3; i++) {
      const riderEmail = `rider.nearby.${i}@test.com`;
      
      // Check if rider already exists
      let rider = await Rider.findOne({ email: riderEmail });

      if (!rider) {
        rider = await Rider.create({
          name: `Driver ${i + 1}`,
          email: riderEmail,
          phone: `989999${1000 + i}`,
          password: await bcrypt.hash('password123', 10),
          photo: `https://api.dicebear.com/7.x/avataaars/svg?seed=Driver${i}`,
          aadhaarNumber: `AAD${Date.now()}${i}`,
          drivingLicenseNumber: `DL${Date.now()}${i}`,
          homeAddress: {
            addressLine: `Near Pickup Location - Driver ${i + 1}`,
            city: 'Test City',
            state: 'Test State',
            pincode: '110001',
            location: {
              lat: locations[i].lat,
              lng: locations[i].lng
            }
          },
          currentLocation: {
            type: 'Point',
            coordinates: [locations[i].lng, locations[i].lat] // GeoJSON format: [lng, lat]
          },
          isEmailVerified: true,
          isPhoneVerified: true,
          isKYCVerified: true,
          status: 'APPROVED',
          isOnline: true,
          isAvailable: true,
          availabilityStatus: 'AVAILABLE',
          overallRating: 4.5 + Math.random(),
          totalRatings: Math.floor(Math.random() * 100) + 10,
          completedRides: Math.floor(Math.random() * 500) + 50
        });
        console.log(`✅ Created rider: ${rider.name} at (${locations[i].lat.toFixed(4)}, ${locations[i].lng.toFixed(4)})`);
      } else {
        // Update existing rider to be online and available
        await Rider.updateOne(
          { _id: rider._id },
          {
            isOnline: true,
            isAvailable: true,
            availabilityStatus: 'AVAILABLE',
            currentLocation: {
              type: 'Point',
              coordinates: [locations[i].lng, locations[i].lat]
            }
          }
        );
        console.log(`✅ Updated rider: ${rider.name} - Now Online & Available`);
      }

      // Create or update cab
      let cab = await Cab.findOne({ cabNumber: `NP${1000 + i}` });

      if (!cab) {
        cab = await Cab.create({
          riderId: rider._id,
          cabType: cabTypes[i],
          cabNumber: `NP${1000 + i}`,
          cabModel: cabModels[i],
          yearOfManufacture: 2023,
          seatingCapacity: cabTypes[i] === 'SUV' ? 7 : 5,
          acAvailable: true,
          isApproved: true,
          isAvailable: true,
          approvalStatus: 'APPROVED',
          approvedAt: new Date()
        });
        console.log(`🚗 Created cab: ${cabTypes[i]} - ${cab.cabNumber}`);
      }

      createdCabs.push(cab);
    }

    console.log('\n✨ Summary:');
    console.log(`✅ Total Cabs Added/Updated: ${createdCabs.length}`);
    console.log(`📍 Pickup Location: (${PICKUP_LAT}, ${PICKUP_LNG})`);
    console.log(`📏 Search Radius: ${SEARCH_RADIUS}km`);
    console.log('\n🚗 Available Cabs:');
    createdCabs.forEach((cab, idx) => {
      console.log(`${idx + 1}. ${cab.cabType} - ${cab.cabNumber}`);
    });

    console.log('\n⏭️  Next Steps:');
    console.log('1. Go back to the booking page');
    console.log('2. Search for cabs at your pickup location');
    console.log('3. You should now see 2-3 available cabs!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
};

seedCabsNearPickup();
