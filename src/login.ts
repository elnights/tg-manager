import 'node:process';
import {createInterface} from 'node:readline/promises';
import qr from 'qrcode-terminal';
import {credentials, makeClient, saveSession} from './client.js';

async function main() {
  const client = makeClient();
  const {apiId, apiHash} = credentials();
  const rl = createInterface({input: process.stdin, output: process.stdout});
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      console.log('Telegram on phone: Settings -> Devices -> Link Desktop Device.');
      await client.signInUserWithQrCode({apiId, apiHash}, {
        qrCode: async code => {
          console.clear();
          console.log('Scan in Telegram -> Settings -> Devices -> Link Desktop Device\n');
          const token = code.token.toString('base64url');
          qr.generate(`tg://login?token=${token}`, {small: true});
        },
        password: async hint => {
          console.log(`Cloud password required${hint ? ` (hint: ${hint})` : ''}.`);
          return await rl.question('Cloud password: ');
        },
        onError: async error => {
          console.error('Authentication error:', error.message);
          return true;
        },
      });
    }
    if (!(await client.checkAuthorization())) throw new Error('Telegram authorization not completed');
    saveSession(client);
    const me = await client.getMe();
    console.log(`\nLogged in as ${'firstName' in me ? me.firstName : 'user'}. Session stored in .local/session.txt`);
  } finally {
    rl.close();
    await client.disconnect();
  }
}

main().catch(e => {console.error(e); process.exitCode = 1;});
