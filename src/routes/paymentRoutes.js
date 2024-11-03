const express = require('express');
const router = express.Router();
const userService = require('../services/userService');

// Register a new user
router.post('/register', (req, res) => {
  const { phoneNumber, paymentPlan } = req.body;
  if (!['free', 'payPerUse', 'subscription'].includes(paymentPlan)) {
    return res.status(400).json({ error: 'Invalid payment plan' });
  }
  const result = userService.registerUser(phoneNumber, paymentPlan);
  if (result.error) {
    res.status(400).json({ error: result.error });
  } else {
    res.json(result);
  }
});

// Add audio minutes (replaces add-credits and add-tokens)
router.post('/add-minutes', (req, res) => {
  const { phoneNumber, minutes } = req.body;
  const result = userService.addAudioMinutes(phoneNumber, minutes);
  if (result.error) {
    res.status(400).json({ error: result.error });
  } else {
    res.json(result);
  }
});

// Extend subscription
router.post('/extend-subscription', (req, res) => {
  const { phoneNumber, months } = req.body;
  const result = userService.extendSubscription(phoneNumber, months);
  if (result.error) {
    res.status(400).json({ error: result.error });
  } else {
    res.json(result);
  }
});

// Get user's remaining time and usage
router.get('/time-usage/:phoneNumber', (req, res) => {
  const { phoneNumber } = req.params;
  const user = userService.getUser(phoneNumber);
  if (user) {
    res.json({
      audioMinutesUsed: user.audioMinutesUsed || 0,
      audioMinutesLimit: user.audioMinutesLimit,
      paymentPlan: user.paymentPlan,
      subscriptionEndDate: user.subscriptionEndDate
    });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Get user's remaining time and usage
router.get('/time-usage/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;
    const user = userService.getUser(phoneNumber);
    if (user) {
      res.json({
        audioMinutesUsed: user.audioMinutesUsed || 0,
        audioMinutesLimit: user.audioMinutesLimit,
        paymentPlan: user.paymentPlan,
        subscriptionEndDate: user.subscriptionEndDate
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

module.exports = router;