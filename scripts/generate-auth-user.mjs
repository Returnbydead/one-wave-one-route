import { pbkdf2Sync, randomBytes } from "node:crypto";

const [staffId, name, role = "DEVELOPER", password] = process.argv.slice(2);
if (!staffId || !name || !password) {
  console.error('Usage: node scripts/generate-auth-user.mjs <STAFF_ID> "<NAME>" <DEVELOPER|STAGING_HELPER|LINE_HELPER> <PASSWORD>');
  process.exit(1);
}
if (!["DEVELOPER", "STAGING_HELPER", "LINE_HELPER"].includes(role)) {
  console.error("Role tidak valid");
  process.exit(1);
}

const iterations = 210_000;
const salt = randomBytes(18);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
console.log(JSON.stringify([{
  staffId: staffId.toUpperCase(),
  name,
  role,
  salt: salt.toString("base64url"),
  hash: hash.toString("base64url"),
  iterations,
}], null, 2));
