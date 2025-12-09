

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import dotenv from "dotenv";
import * as DynamoGoogleUser from "../models/DynamoGoogleUser.js";

dotenv.config();

const PROD_BACKEND_BASE = 'https://www.caasdiglobal.in';
const DEV_BACKEND_BASE = 'http://localhost:5001';
const backendBaseUrl =
  process.env.VENDOR_BACKEND_URL ||
  (process.env.NODE_ENV === 'production' ? PROD_BACKEND_BASE : DEV_BACKEND_BASE);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${backendBaseUrl}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("Google profile received:", profile.id, profile.displayName, profile.emails[0].value);
        
        // Check if user exists in DynamoDB
        let dynamoUser = await DynamoGoogleUser.getGoogleUserByGoogleId(profile.id);
        
        if (dynamoUser) {
          console.log("Existing user found in DynamoDB:", dynamoUser.email);
          
          // Convert DynamoDB user to format expected by passport
          const passportUser = {
            _id: dynamoUser.id, // Use id as _id for passport
            id: dynamoUser.id,
            googleId: dynamoUser.googleId,
            displayName: dynamoUser.displayName,
            email: dynamoUser.email,
            role: dynamoUser.role || 'vendor',
            status: dynamoUser.status || 'pending',
            hasFilledForm: dynamoUser.hasFilledForm || false,
            source: 'dynamodb'
          };
          
          return done(null, passportUser);
        }
        
        // If user doesn't exist, create in DynamoDB
        const newGoogleUserData = {
          googleId: profile.id,
          displayName: profile.displayName,
          email: profile.emails[0].value,
          role: 'vendor',
          status: 'pending',
          hasFilledForm: false
        };
        
        dynamoUser = await DynamoGoogleUser.createGoogleUser(newGoogleUserData);
        console.log("New user created in DynamoDB:", dynamoUser.email);
        
        // Convert DynamoDB user to format expected by passport
        const passportUser = {
          _id: dynamoUser.id, // Use id as _id for passport
          id: dynamoUser.id,
          googleId: dynamoUser.googleId,
          displayName: dynamoUser.displayName,
          email: dynamoUser.email,
          role: dynamoUser.role || 'vendor',
          status: dynamoUser.status || 'pending',
          hasFilledForm: dynamoUser.hasFilledForm || false,
          source: 'dynamodb'
        };
        
        return done(null, passportUser);
      } catch (err) {
        console.error("Error in Google Strategy:", err.stack);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  console.log("Serializing user with ID:", user._id);
  // Just store the ID since we're only using DynamoDB now
  done(null, user._id);
});

passport.deserializeUser(async (serialized, done) => {
  try {
    let id;
    
    // Handle both old format (string ID) and new format (object with ID and source)
    if (typeof serialized === 'object') {
      id = serialized.id;
    } else {
      id = serialized;
    }
    
    // Get user from DynamoDB
    let user = await DynamoGoogleUser.getGoogleUserById(id);
    
    if (user) {
      // Convert to format expected by passport
      user = {
        _id: user.id,
        id: user.id,
        googleId: user.googleId,
        displayName: user.displayName,
        email: user.email,
        role: user.role || 'vendor',
        status: user.status || 'pending',
        hasFilledForm: user.hasFilledForm || false,
        source: 'dynamodb'
      };
    }
    
    if (!user) {
      console.log("User not found during deserialization, ID:", id);
      return done(null, false);
    }
    
    console.log("Deserialized user:", user.email);
    done(null, user);
  } catch (err) {
    console.error("Error deserializing user:", err.stack);
    done(err, null);
  }
});

export default passport;