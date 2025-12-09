import { kms, KMS_KEY_ID } from '../config/aws.js';

/**
 * Encrypt a message using AWS KMS
 * @param {string} plaintext - The message to encrypt
 * @returns {Promise<string>} - Base64 encoded encrypted message
 */
export const encryptMessage = async (plaintext) => {
  try {
    console.log('🔐 KMS: Encrypting message...');
    
    const params = {
      KeyId: KMS_KEY_ID,
      Plaintext: Buffer.from(plaintext, 'utf8')
    };

    const result = await kms.encrypt(params).promise();
    const encryptedMessage = Buffer.from(result.CiphertextBlob).toString('base64');
    
    console.log('✅ KMS: Message encrypted successfully');
    return encryptedMessage;
  } catch (error) {
    console.error('❌ KMS: Error encrypting message:', error);
    throw new Error(`Failed to encrypt message: ${error.message}`);
  }
};

/**
 * Decrypt a message using AWS KMS
 * @param {string} encryptedMessage - Base64 encoded encrypted message
 * @returns {Promise<string>} - Decrypted plaintext message
 */
export const decryptMessage = async (encryptedMessage) => {
  try {
    console.log('🔓 KMS: Decrypting message...');
    
    const params = {
      CiphertextBlob: Buffer.from(encryptedMessage, 'base64')
    };

    const result = await kms.decrypt(params).promise();
    const decryptedMessage = result.Plaintext.toString('utf8');
    
    console.log('✅ KMS: Message decrypted successfully');
    return decryptedMessage;
  } catch (error) {
    console.error('❌ KMS: Error decrypting message:', error);
    throw new Error(`Failed to decrypt message: ${error.message}`);
  }
};

/**
 * Encrypt multiple messages in batch
 * @param {string[]} messages - Array of messages to encrypt
 * @returns {Promise<string[]>} - Array of encrypted messages
 */
export const encryptMessages = async (messages) => {
  try {
    console.log(`🔐 KMS: Encrypting ${messages.length} messages in batch...`);
    
    const encryptedMessages = await Promise.all(
      messages.map(message => encryptMessage(message))
    );
    
    console.log('✅ KMS: Batch encryption completed');
    return encryptedMessages;
  } catch (error) {
    console.error('❌ KMS: Error in batch encryption:', error);
    throw error;
  }
};

/**
 * Decrypt multiple messages in batch
 * @param {string[]} encryptedMessages - Array of encrypted messages
 * @returns {Promise<string[]>} - Array of decrypted messages
 */
export const decryptMessages = async (encryptedMessages) => {
  try {
    console.log(`🔓 KMS: Decrypting ${encryptedMessages.length} messages in batch...`);
    
    const decryptedMessages = await Promise.all(
      encryptedMessages.map(encryptedMessage => decryptMessage(encryptedMessage))
    );
    
    console.log('✅ KMS: Batch decryption completed');
    return decryptedMessages;
  } catch (error) {
    console.error('❌ KMS: Error in batch decryption:', error);
    throw error;
  }
};
