import crypto from "node:crypto";

const IV_LENGTH = 12;

const toKeyBuffer = (rawKey: string): Buffer => {
  const hash = crypto.createHash("sha256");
  hash.update(rawKey);
  return hash.digest();
};

export const encrypt = (value: string, rawKey: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = toKeyBuffer(rawKey);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decrypt = (value: string, rawKey: string): string => {
  const [ivHex, tagHex, payloadHex] = value.split(":");
  if (!ivHex || !tagHex || !payloadHex) {
    throw new Error("Encrypted payload format is invalid");
  }
  const key = toKeyBuffer(rawKey);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};
