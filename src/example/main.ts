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

  const searchResults = await session.searchProducts('milk', 5);
  console.log(`Found ${searchResults.totalResults} products for "milk"`);
  console.log('First 5 results:');
  searchResults.results.forEach((product, index) => {
    console.log(
      `${index + 1}. ${product.name} - ${product.formattedPrice} (${product.inStock ? 'In Stock' : 'Out of Stock'})`,
    );
  });

  const specificProduct = await session.getProductByCode('P_8004399331396');
  if (specificProduct) {
    console.log(
      `\nFound specific product: ${specificProduct.name} - ${specificProduct.formattedPrice}`,
    );
  } else {
    console.log('\nSpecific product not found');
  }

  const orders = await session.getOrders();
  const lastOrder = orders.closedOrders[0];
  if (lastOrder) {
    const orderDetails = await session.getOrderDetails(lastOrder.code);
    const firstItem = orderDetails.items[0];

    const cartItems = await session.getCartItems();
    if (
      !cartItems.some((item) => item.productCode === firstItem.product.code)
    ) {
      await session.addToCart([
        { ...firstItem, sellingMethod: firstItem.product.sellingMethod },
      ]);
    } else {
      console.log('Product already in cart');
    }
    await session.removeFromCart(firstItem.product.code);

    const selectedTimeSlot = await session.getSelectedTimeSlot();
    if (!selectedTimeSlot) {
      const availableTimeSlots = await session.getAvailableTimeSlots();
      const lastTimeSlot = availableTimeSlots[availableTimeSlots.length - 1];
      console.log('Selecting last available time slot:', lastTimeSlot);
      await session.selectTimeSlot(lastTimeSlot.code);
    } else {
      console.log('Time slot already selected:', selectedTimeSlot);
    }

    // Uncomment to create order
    // await session.createOrder(true);
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
