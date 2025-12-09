/**
 * DEPRECATED: This file is no longer used in the application.
 * It has been replaced by DynamoDB implementations.
 * Kept for reference only.
 */
import dotenv from 'dotenv';
dotenv.config();
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import GoogleUser from '../models/GoogleUser';

const PROD_BACKEND_BASE = 'https://www.caasdiglobal.in';
const DEV_BACKEND_BASE = 'http://localhost:5001';
const backendBaseUrl =
  process.env.VENDOR_BACKEND_URL ||
  (process.env.NODE_ENV === 'production' ? PROD_BACKEND_BASE : DEV_BACKEND_BASE);

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: `${backendBaseUrl}/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      // Save profile info to DB or session
      try {
        let user = await GoogleUser.findOne({ googleId: profile.id });
        if (!user) {
          user = await GoogleUser.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            role: null
          });
        }
        if (!user.googleId) {
          console.error('Google authentication failed - no googleId');
          return done(new Error('Missing googleId'), null);
        }
        done(null, {
          googleId: user.googleId,
          _id: user._id,
          role: user.role
        });
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, {
    googleId: user.googleId,
    _id: user._id,
    role: user.role
  });
});

passport.deserializeUser(async (user, done) => {
  try {
    const dbUser = await GoogleUser.findById(user._id);
    done(null, dbUser);
  } catch (err) {
    done(err, null);
  }
});
