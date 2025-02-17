import { ShufersalBot } from '@shufersal-automation';
import * as dotenv from 'dotenv';

dotenv.config();

const USERNAME = process.env['SHUFERSAL_USERNAME'];
const PASSWORD = process.env['SHUFERSAL_PASSWORD'];
const EXECUTABLE_PATH = process.env['CHROME_PATH'];

if (!USERNAME || !PASSWORD) {
  throw new Error('SHUFERSAL_USERNAME and SHUFERSAL_PASSWORD must be set');
}
if (!EXECUTABLE_PATH) {
  throw new Error('CHROME_PATH must be set');
}

async function automate(bot: ShufersalBot, username: string, password: string) {
  const page = await bot.createPage();
  await bot.login(page, username, password);
  const orders = await bot.getOrders(page);
  const lastOrder = orders.closedOrders[0];
  if (lastOrder) {
    const orderDetails = await bot.getOrderDetails(page, lastOrder.code);
    console.log(`Last order had ${orderDetails.entries.length} entries`);
  } else {
    console.log('No closed orders found');
  }
}

(async () => {
  const bot = new ShufersalBot({
    executablePath: EXECUTABLE_PATH,
  });
  try {
    await automate(bot, USERNAME, PASSWORD);
  } catch (error) {
    console.error(error);
  } finally {
    await bot.terminate();
  }
})();
