import * as fs from 'fs';

const AUTH_FILE = 'auth.json';

export default async function globalTeardown() {
  if (fs.existsSync(AUTH_FILE)) {
    fs.unlinkSync(AUTH_FILE);
  }
}
