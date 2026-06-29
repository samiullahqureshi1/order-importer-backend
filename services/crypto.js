const crypto = require('crypto');
require('dotenv').config();

// Ensure ENCRYPTION_KEY is exactly 32 bytes (64 hex characters if hex, or we can use a hash)
let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
    // Generate a random key if none is provided for dev (in production, MUST provide one)
    ENCRYPTION_KEY = crypto.randomBytes(32);
    console.warn('WARNING: ENCRYPTION_KEY not found in environment. Using a random temporary key. Tokens will be unrecoverable across restarts.');
} else {
    // If it's a hex string from env, convert to buffer, else assume it's a 32-char string
    if (ENCRYPTION_KEY.length === 64) {
        ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY, 'hex');
    } else {
        ENCRYPTION_KEY = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
    }
}

const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted,
        authTag: authTag
    };
}

function decrypt(encryptedData, ivHex, authTagHex) {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

module.exports = {
    encrypt,
    decrypt
};
