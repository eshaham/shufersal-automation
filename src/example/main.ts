import { ShufersalBot } from '@shufersal-automation';
import dotenv from 'dotenv';

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
  const session = await bot.createSession(username, password);
  const orders = await session.getOrders();
  const lastOrder = orders.closedOrders[0];
  if (lastOrder) {
    const orderDetails = await session.getOrderDetails(lastOrder.code);
    const firstEntry = orderDetails.entries[0];

    const cartItems = await session.getCartItems();
    if (
      !cartItems.some((item) => item.productCode === firstEntry.product.code)
    ) {
      await session.addToCart([
        {
          productCode: firstEntry.product.code,
          frontQuantity: firstEntry.quantity,
          quantity: firstEntry.quantity,
          sellingMethod: firstEntry.product.sellingMethod.code,
          comment: '',
          longTail: false,
        },
      ]);
    } else {
      console.log('Product already in cart');
    }
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
