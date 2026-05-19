# Simple Solana Devnet Wallet — Chrome Extension

A beginner-friendly Chrome extension wallet for Solana Devnet.  
No frameworks, no build tools, no complexity — just plain HTML, CSS, and JavaScript.

---

## Files in This Project

```
solana-wallet-extension/
├── manifest.json   ← Chrome extension config
├── popup.html      ← The wallet UI
├── popup.css       ← All the styling
├── popup.js        ← All the wallet logic
├── icon.png        ← Extension icon
└── README.md       ← This file
```

---

## How to Install in Chrome

1. Open Chrome and go to: `chrome://extensions/`
2. Toggle **"Developer mode"** ON (top-right corner)
3. Click **"Load unpacked"**
4. Select the `solana-wallet-extension` folder
5. The wallet will appear in your extensions list
6. Click the puzzle piece 🧩 in Chrome's toolbar → pin the wallet

---

## How to Use

### First Time
1. Click the wallet icon in your toolbar
2. Click **"Generate New Wallet"**
3. Your wallet address appears — copy it

### Get Free Test SOL (Devnet Airdrop)
1. Copy your wallet address
2. Go to **https://faucet.solana.com/**
3. Paste your address and request an airdrop
4. Come back and click **"Refresh Balance"**

### Send SOL
1. Paste the recipient's Solana address
2. Enter the amount (e.g. `0.01`)
3. Click **"Send SOL"**
4. The transaction ID will appear on success
5. You can verify it at: https://explorer.solana.com/?cluster=devnet

---

## How It Works (Simple Explanation)

| What | How |
|------|-----|
| Wallet generation | `solanaWeb3.Keypair.generate()` creates a random key pair |
| Saving the wallet | Secret key stored as a number array in `chrome.storage.local` |
| Loading the wallet | Read from storage, rebuild with `Keypair.fromSecretKey()` |
| Checking balance | `connection.getBalance(publicKey)` returns lamports → divide by 1B for SOL |
| Sending SOL | Build a `Transaction` with `SystemProgram.transfer()`, sign with keypair, send |

---

## ⚠️ Security Warning

This is a **learning project** for Devnet only.

- The secret key is stored **unencrypted** in Chrome local storage
- **Never** use this wallet for real SOL on Mainnet
- **Never** share your secret key with anyone

---

## Troubleshooting

**Balance won't load?**  
→ Check your internet connection. Devnet can be slow — try again.

**"Invalid recipient address"?**  
→ Make sure you copied the full Solana address (44 characters, base58 encoded).

**Extension won't load?**  
→ Make sure all 5 files are in the same folder and Developer Mode is on.

**Transaction failed with "insufficient funds"?**  
→ You need more SOL. Use the faucet at https://faucet.solana.com/
