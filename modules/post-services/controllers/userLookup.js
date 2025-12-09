import * as DynamoGoogleUser from '../../../models/DynamoGoogleUser.js';
import * as DynamoUser from '../../../models/DynamoUser.js'; // Assuming this path is correct

export const lookupUser = async (identifier) => {
  // Try to find user by email in DynamoGoogleUser
  let user = await DynamoGoogleUser.getGoogleUserByEmail(identifier);
  if (user) {
    return {
      userId: user.userId || user.id, // Prioritize userId, fallback to id
      email: user.email,
      name: user.displayName || user.email.split('@')[0],
      role: user.role || 'google_user',
    };
  }

  // If not found, try to find user by email in DynamoUser (general users table)
  user = await DynamoUser.getUserByEmail(identifier);
  if (user) {
    return {
      userId: user.userId || user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      role: user.role || 'general_user',
    };
  }

  // If still not found, try to find user by ID in DynamoGoogleUser (if identifier looks like an ID)
  // This is a fallback and might not always be reliable if IDs are not consistently email-like.
  if (identifier && identifier.length === 36 && identifier.includes('-')) { // Simple check for UUID-like string
    user = await DynamoGoogleUser.getGoogleUserById(identifier);
    if (user) {
      return {
        userId: user.userId || user.id,
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        role: user.role || 'google_user',
      };
    }
  }

  return null; // User not found
};

