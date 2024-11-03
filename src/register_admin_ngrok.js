const axios = require('axios');

const NGROK_URL = 'https://0fb9-147-236-116-94.ngrok-free.app'; // Replace with your ngrok URL
const ADMIN_PHONE_NUMBER = '972547594343'; // Replace with your WhatsApp number

async function registerAdmin() {
  try {
    const response = await axios.post(`${NGROK_URL}/api/payments/register`, {
      phoneNumber: ADMIN_PHONE_NUMBER,
      paymentPlan: 'free'
    });

    console.log('Admin registration successful:', response.data);
    console.log('You can now use the bot with your phone number:', ADMIN_PHONE_NUMBER);
  } catch (error) {
    console.error('Error registering admin:');
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Server responded with:', error.response.data);
      console.error('Status code:', error.response.status);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server. Check if your server is running and ngrok is set up correctly.');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up the request:', error.message);
    }
    console.error('Make sure your ngrok URL and phone number are correct in the script.');
  }
}

registerAdmin();