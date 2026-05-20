// ============================================================
// XENON WALLET - popup.js
// ============================================================
// Handles everything:
//   1. Multiple accounts — create, switch, stored in chrome.storage
//   2. Balance fetching from Solana Devnet
//   3. Sending SOL transactions
//   4. Recent transaction history
//   5. Address book (save / delete contacts)
// ============================================================


// ============================================================
// GLOBAL SETUP
// ============================================================

// Solana Devnet RPC — free public endpoint for testing
const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

// Connection object — this is how we talk to the Solana blockchain
const connection = new window.solanaWeb3.Connection(DEVNET_RPC_URL, 'confirmed');

// The currently active keypair (the wallet we're looking at right now)
// This gets set whenever we load or switch accounts
let userKeypair = null;

// The index of the active account inside the allAccounts array
// e.g. 0 = first account, 1 = second account, etc.
let activeAccountIndex = 0;


// ============================================================
// INITIALIZATION
// Runs automatically when the popup HTML finishes loading
// ============================================================
document.addEventListener('DOMContentLoaded', async function () {
  console.log('Popup opened.');

  // Check storage for existing accounts and load the active one
  await loadWalletFromStorage();

  // Wire up all button click handlers
  setupButtonListeners();
});


// ============================================================
// LOAD WALLET FROM STORAGE
// ============================================================
// We now store ALL accounts as an array called 'allAccounts'
// Each item looks like: { name: "Account 1", secretKey: [12, 45, 200, ...] }
// We also store 'activeAccountIndex' to remember which one was last selected
async function loadWalletFromStorage() {

  chrome.storage.local.get(['allAccounts', 'activeAccountIndex'], function (result) {

    // Check if we have any accounts saved at all
    if (result.allAccounts && result.allAccounts.length > 0) {

      // We have accounts! Figure out which one was active last time
      // If activeAccountIndex was never saved, default to 0 (first account)
      activeAccountIndex = result.activeAccountIndex || 0;

      // Safety check: if the saved index is out of range, reset to 0
      if (activeAccountIndex >= result.allAccounts.length) {
        activeAccountIndex = 0;
      }

      // Load the active account's keypair into memory
      loadKeypairAtIndex(result.allAccounts, activeAccountIndex);

      // Show the main wallet screen
      showWalletScreen();

      // Load data for the active account
      refreshBalance();
      loadRecentTransactions();
      loadContacts();
      loadAccountsList();
      fetchSolPrice();
      fetchAndDrawChart();

    } else {
      // No accounts found at all — show the onboarding screen
      console.log('No accounts found. Showing onboarding.');
      showOnboardingScreen();
    }

  });
}


// ============================================================
// LOAD KEYPAIR AT INDEX
// ============================================================
// Given the full allAccounts array and an index number,
// this function rebuilds the Keypair object for that account
// and sets it as the active userKeypair
function loadKeypairAtIndex(allAccounts, index) {

  // Get the account object at the given index
  const account = allAccounts[index];

  // The secret key was saved as a plain array of numbers
  // Convert it back to a Uint8Array so Solana can use it
  const secretKeyBytes = new Uint8Array(account.secretKey);

  // Rebuild the full Keypair from the secret key bytes
  userKeypair = window.solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);

  console.log('Loaded account:', account.name, '| Public key:', userKeypair.publicKey.toString());
}


// ============================================================
// CREATE FIRST WALLET (Onboarding button)
// ============================================================
// Called when the user clicks "Create Wallet" on the onboarding screen
// This creates the very first account
async function generateNewWallet() {
  try {
    console.log('Creating first wallet...');

    // Generate a brand new random keypair
    const newKeypair = window.solanaWeb3.Keypair.generate();

    // Build the account object to save
    // secretKey must be a plain array (not Uint8Array) for chrome.storage
    const newAccount = {
      name: 'Account 1',
      secretKey: Array.from(newKeypair.secretKey)
    };

    // Save as an array with one item, and set active index to 0
    chrome.storage.local.set({
      allAccounts: [newAccount],
      activeAccountIndex: 0
    }, function () {
      console.log('First wallet saved.');

      // Set the global keypair variable
      userKeypair = newKeypair;
      activeAccountIndex = 0;

      // Show the main wallet screen
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadContacts();
      loadAccountsList();
      fetchSolPrice();
      fetchAndDrawChart();
    });

  } catch (error) {
    console.error('Error creating wallet:', error);
    showStatus('Error creating wallet: ' + error.message, 'error');
  }
}


// ============================================================
// ADD A NEW ACCOUNT
// ============================================================
// Called when the user clicks "+ Add Account" in the accounts panel
// Creates a new keypair and adds it to the existing allAccounts array
function addNewAccount() {

  // First, read the existing accounts from storage
  chrome.storage.local.get(['allAccounts'], function (result) {

    // Get the existing list, or start fresh if somehow empty
    const allAccounts = result.allAccounts || [];

    // Generate a brand new random keypair for the new account
    const newKeypair = window.solanaWeb3.Keypair.generate();

    // Give it a name like "Account 2", "Account 3", etc.
    // We use allAccounts.length + 1 because the new one hasn't been added yet
    const newAccountName = 'Account ' + (allAccounts.length + 1);

    // Build the account object
    const newAccount = {
      name: newAccountName,
      secretKey: Array.from(newKeypair.secretKey)
    };

    // Push the new account onto the array
    allAccounts.push(newAccount);

    // The new account's index is the last position in the array
    const newIndex = allAccounts.length - 1;

    // Save the updated array and set the new account as active
    chrome.storage.local.set({
      allAccounts: allAccounts,
      activeAccountIndex: newIndex
    }, function () {
      console.log('New account added:', newAccountName);

      // Update the global variables
      userKeypair = newKeypair;
      activeAccountIndex = newIndex;

      // Refresh the UI to show the new account's data
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadAccountsList();

      // Go back to the main screen so the user can see their new account
      showPanel('main-content');
    });

  });
}


// ============================================================
// SWITCH TO A DIFFERENT ACCOUNT
// ============================================================
// Called when the user clicks on an account in the accounts list
// index = the position of the account they want to switch to
function switchToAccount(index) {

  chrome.storage.local.get(['allAccounts'], function (result) {

    const allAccounts = result.allAccounts || [];

    // Make sure the index is valid
    if (index < 0 || index >= allAccounts.length) {
      console.error('Invalid account index:', index);
      return;
    }

    // Save the new active index to storage so it persists after popup closes
    chrome.storage.local.set({ activeAccountIndex: index }, function () {

      // Update the global variables
      activeAccountIndex = index;
      loadKeypairAtIndex(allAccounts, index);

      // Refresh the UI with the new account's data
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadAccountsList();

      // Close the accounts panel and go back to main
      showPanel('main-content');

      console.log('Switched to account index:', index);
    });

  });
}


// ============================================================
// LOAD ACCOUNTS LIST (in the Accounts panel)
// ============================================================
// Reads all accounts from storage and builds the list UI
// Shows which one is currently active with a checkmark
function loadAccountsList() {

  chrome.storage.local.get(['allAccounts', 'activeAccountIndex'], function (result) {

    const allAccounts = result.allAccounts || [];
    const currentIndex = result.activeAccountIndex || 0;

    // Update the topbar to show the active account name
    if (allAccounts[currentIndex]) {
      document.getElementById('active-account-name').textContent = allAccounts[currentIndex].name;
    }

    // Get the <ul> element in the accounts panel
    const accountsList = document.getElementById('accounts-list');
    accountsList.innerHTML = '';

    // Build a row for each account
    for (let i = 0; i < allAccounts.length; i++) {

      // Rebuild the keypair just to get the public key for display
      const secretKeyBytes = new Uint8Array(allAccounts[i].secretKey);
      const keypair = window.solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);
      const fullAddress = keypair.publicKey.toString();

      // Shorten the address for display
      const shortAddr = fullAddress.slice(0, 6) + '...' + fullAddress.slice(-4);

      // Is this the currently active account?
      const isActive = (i === currentIndex);

      const li = document.createElement('li');
      li.className = 'account-row' + (isActive ? ' account-row-active' : '');

      li.innerHTML =
        '<div class="account-info">' +
          '<span class="account-name">' + allAccounts[i].name + '</span>' +
          '<span class="account-addr">' + shortAddr + '</span>' +
        '</div>' +
        // Show a checkmark if this is the active account, otherwise a "switch" button
        (isActive
          ? '<span class="account-active-badge">&#10003; Active</span>'
          : '<button class="account-switch-btn" data-index="' + i + '">Switch</button>'
        );

      accountsList.appendChild(li);
    }

    // Wire up the Switch buttons — we do this after building the list
    // because the buttons didn't exist before
    const switchButtons = document.querySelectorAll('.account-switch-btn');
    for (let i = 0; i < switchButtons.length; i++) {
      switchButtons[i].addEventListener('click', function () {
        const indexToSwitchTo = parseInt(this.getAttribute('data-index'));
        switchToAccount(indexToSwitchTo);
      });
    }

  });
}


// ============================================================
// FETCH AND DRAW THE 7-DAY PRICE CHART
// ============================================================
// First tries our local price server.
// If that fails (server not running), falls back to CoinGecko directly.
async function fetchAndDrawChart() {
  try {
    let prices = null;

    // --- Try the local price server first ---
    try {
      const response = await fetch('http://localhost:3000/api/history');
      if (response.ok) {
        const data = await response.json();
        if (data.prices && data.prices.length > 0) {
          prices = data.prices;
          console.log('Chart data loaded from local server.');
        }
      }
    } catch (localError) {
      // Local server not running — that's fine, we'll try CoinGecko directly
      console.log('Local server unavailable, falling back to CoinGecko...');
    }

    // --- Fallback: fetch directly from CoinGecko ---
    if (!prices) {
      const cgUrl = 'https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7';
      const cgResponse = await fetch(cgUrl);

      if (!cgResponse.ok) {
        throw new Error('CoinGecko returned ' + cgResponse.status);
      }

      const cgData = await cgResponse.json();

      // cgData.prices is an array of [timestamp, price] pairs
      // We only need the price values (index 1 of each pair)
      prices = cgData.prices.map(function (point) {
        return point[1];
      });

      console.log('Chart data loaded from CoinGecko. Points:', prices.length);
    }

    if (!prices || prices.length === 0) {
      console.log('No price data available.');
      return;
    }

    // --- Update the header text ---
    const currentPrice = prices[prices.length - 1];
    const firstPrice = prices[0];
    const changePercent = ((currentPrice - firstPrice) / firstPrice) * 100;
    const changeSign = changePercent >= 0 ? '+' : '';

    document.getElementById('chart-current-price').textContent =
      '$' + currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const changeEl = document.getElementById('chart-change');
    changeEl.textContent = changeSign + changePercent.toFixed(2) + '%';
    changeEl.className = 'chart-change ' + (changePercent >= 0 ? 'chart-change-up' : 'chart-change-down');

    // --- Draw the chart ---
    drawLineChart(prices);

  } catch (error) {
    console.error('Could not load chart data:', error.message);
    document.getElementById('chart-current-price').textContent = 'Unavailable';
  }
}


// ============================================================
// DRAW THE LINE CHART ON THE CANVAS
// ============================================================
// prices = array of numbers like [140.2, 141.5, 139.8, ...]
// We use the HTML5 Canvas API to draw a smooth line chart.
function drawLineChart(prices) {

  // Get the canvas element from the HTML
  const canvas = document.getElementById('price-chart');

  // getContext('2d') gives us the drawing tools
  const ctx = canvas.getContext('2d');

  const width = canvas.width;    // 320px
  const height = canvas.height;  // 100px
  const padding = 8;             // Space around the edges so the line doesn't clip

  // Clear the canvas before drawing (in case we redraw)
  ctx.clearRect(0, 0, width, height);

  // Find the min and max price in the data so we can scale the chart
  // Math.min(...prices) spreads the array as individual arguments
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // The price range — used to scale prices to pixel heights
  const priceRange = maxPrice - minPrice;

  // If all prices are the same (flat line), avoid dividing by zero
  const safeRange = priceRange === 0 ? 1 : priceRange;

  // --- Helper: convert a price value to a Y pixel position ---
  // Higher price = lower Y value (canvas Y goes top to bottom)
  function priceToY(price) {
    // Normalize price to 0-1 range, then flip and scale to canvas height
    return height - padding - ((price - minPrice) / safeRange) * (height - padding * 2);
  }

  // --- Helper: convert an index to an X pixel position ---
  function indexToX(i) {
    return padding + (i / (prices.length - 1)) * (width - padding * 2);
  }

  // --- Draw the gradient fill under the line ---
  // This makes the chart look like the Fuzz wallet reference
  const gradient = ctx.createLinearGradient(0, 0, 0, height);

  // Determine color based on whether price went up or down
  const isUp = prices[prices.length - 1] >= prices[0];
  const lineColor = isUp ? '#4ade80' : '#f87171';       // green or red
  const gradientTop = isUp ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)';
  const gradientBottom = 'rgba(0,0,0,0)';

  gradient.addColorStop(0, gradientTop);
  gradient.addColorStop(1, gradientBottom);

  // Start drawing the filled area path
  ctx.beginPath();
  ctx.moveTo(indexToX(0), priceToY(prices[0]));

  // Draw a smooth curve through all the price points
  // We use quadratic bezier curves for smoothness
  for (let i = 1; i < prices.length; i++) {
    const prevX = indexToX(i - 1);
    const currX = indexToX(i);
    const prevY = priceToY(prices[i - 1]);
    const currY = priceToY(prices[i]);

    // Control point is the midpoint between previous and current X
    const midX = (prevX + currX) / 2;
    ctx.quadraticCurveTo(prevX, prevY, midX, (prevY + currY) / 2);
  }

  // Finish the last segment
  ctx.lineTo(indexToX(prices.length - 1), priceToY(prices[prices.length - 1]));

  // Close the path down to the bottom of the canvas to create the fill area
  ctx.lineTo(indexToX(prices.length - 1), height);
  ctx.lineTo(indexToX(0), height);
  ctx.closePath();

  // Fill with the gradient
  ctx.fillStyle = gradient;
  ctx.fill();

  // --- Draw the actual line on top of the gradient ---
  ctx.beginPath();
  ctx.moveTo(indexToX(0), priceToY(prices[0]));

  for (let i = 1; i < prices.length; i++) {
    const prevX = indexToX(i - 1);
    const currX = indexToX(i);
    const prevY = priceToY(prices[i - 1]);
    const currY = priceToY(prices[i]);
    const midX = (prevX + currX) / 2;
    ctx.quadraticCurveTo(prevX, prevY, midX, (prevY + currY) / 2);
  }

  ctx.lineTo(indexToX(prices.length - 1), priceToY(prices[prices.length - 1]));

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // --- Draw a dot at the current (last) price point ---
  const dotX = indexToX(prices.length - 1);
  const dotY = priceToY(prices[prices.length - 1]);

  ctx.beginPath();
  ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
}


// ============================================================
// FETCH SOL PRICE FROM LOCAL PRICE SERVER
// ============================================================
// Our price server runs at localhost:3000 and caches the
// CoinGecko price every 5 minutes. We call it here instead
// of calling CoinGecko directly to avoid rate limits.
async function fetchSolPrice() {
  try {
    // Call our local price server endpoint
    const response = await fetch('http://localhost:3000/api/prices');

    // If the server responded but with an error status, throw
    if (!response.ok) {
      throw new Error('Server returned status ' + response.status);
    }

    // Parse the JSON response
    // It looks like: { usd: 84.12, inr: 8145.44, lastUpdated: "..." }
    const data = await response.json();

    // Format the price display string
    // e.g. "1 SOL = $84.12 · ₹8,145"
    const usd = data.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const inr = data.inr.toLocaleString('en-IN', { maximumFractionDigits: 0 });

    document.getElementById('sol-price-display').textContent = '1 SOL = $' + usd + ' · ₹' + inr;

    console.log('Price loaded from server:', data);

  } catch (error) {
    // If the server isn't running or there's a network error, show a fallback
    console.error('Could not fetch price:', error.message);
    document.getElementById('sol-price-display').textContent = 'Price unavailable (start price server)';
  }
}


// ============================================================
// REFRESH BALANCE
// ============================================================
async function refreshBalance() {
  try {
    if (!userKeypair) {
      showStatus('No wallet loaded.', 'error');
      return;
    }

    showStatus('Fetching balance...', 'info');

    // getBalance() returns the balance in lamports (smallest unit of SOL)
    // 1 SOL = 1,000,000,000 lamports
    const balanceInLamports = await connection.getBalance(userKeypair.publicKey);

    // Divide by 1 billion to convert lamports to SOL
    const balanceInSOL = balanceInLamports / 1000000000;

    document.getElementById('balance-amount').textContent = balanceInSOL.toFixed(4);

    showStatus('Balance updated!', 'success');
    setTimeout(function () {
      document.getElementById('status-message').style.display = 'none';
    }, 2000);

  } catch (error) {
    console.error('Error fetching balance:', error);
    showStatus('Could not fetch balance: ' + error.message, 'error');
  }
}


// ============================================================
// ESTIMATE TRANSACTION FEE
// ============================================================
// Builds the exact transaction the user wants to send,
// asks the network how much it will cost, and shows it
// in the fee preview box before the user confirms.
async function estimateFee() {
  try {
    // Read the inputs
    const recipientAddressStr = document.getElementById('recipient-address').value.trim();
    const amountStr = document.getElementById('send-amount').value.trim();

    // Basic validation before we even try
    if (!recipientAddressStr) {
      showStatus('Please enter a recipient address first.', 'error');
      return;
    }
    if (!amountStr || parseFloat(amountStr) <= 0) {
      showStatus('Please enter a valid amount first.', 'error');
      return;
    }

    const amountInSOL = parseFloat(amountStr);
    const amountInLamports = Math.floor(amountInSOL * 1000000000);

    // Validate the recipient address format
    let recipientPublicKey;
    try {
      recipientPublicKey = new window.solanaWeb3.PublicKey(recipientAddressStr);
    } catch (err) {
      showStatus('Invalid recipient address.', 'error');
      return;
    }

    showStatus('Estimating fee...', 'info');

    // ---- Build the transaction message ----
    // We build the full transaction just like we would for sending,
    // but instead of sending it we ask the network for its fee.

    // Step 1: Get the latest blockhash
    // Every Solana transaction needs a recent blockhash to be valid.
    // Think of it like a timestamp that proves the transaction is fresh.
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // Step 2: Build the transfer instruction
    const transferInstruction = window.solanaWeb3.SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: recipientPublicKey,
      lamports: amountInLamports
    });

    // Step 3: Build the transaction message
    // A TransactionMessage is the "unsigned" version of a transaction.
    // We use it here just to get the fee — we don't sign it yet.
    const message = new window.solanaWeb3.TransactionMessage({
      payerKey: userKeypair.publicKey,   // Who pays the fee (us)
      recentBlockhash: blockhash,         // The fresh blockhash we just got
      instructions: [transferInstruction] // The list of things to do
    }).compileToV0Message();
    // compileToV0Message() converts it to the format getFeeForMessage() expects

    // Step 4: Ask the network how much this transaction will cost
    // getFeeForMessage() returns the fee in lamports, or null if it can't estimate
    const feeResponse = await connection.getFeeForMessage(message, 'confirmed');

    // feeResponse.value is the fee in lamports (or null)
    const feeInLamports = feeResponse.value;

    if (feeInLamports === null) {
      showStatus('Could not estimate fee. Try again.', 'error');
      return;
    }

    // Convert fee from lamports to SOL for display
    // Fees are tiny — usually 5000 lamports = 0.000005 SOL
    const feeInSOL = feeInLamports / 1000000000;

    // Total cost = amount being sent + the fee
    const totalInSOL = amountInSOL + feeInSOL;

    // ---- Update the fee preview box ----
    document.getElementById('fee-amount-display').textContent = amountInSOL.toFixed(6) + ' SOL';
    document.getElementById('fee-estimate-display').textContent = feeInSOL.toFixed(6) + ' SOL';
    document.getElementById('fee-total-display').textContent = totalInSOL.toFixed(6) + ' SOL';

    // Show the fee preview box
    document.getElementById('fee-preview').style.display = 'block';

    // Hide the "Preview Fee" button and show the "Confirm & Send" button
    document.getElementById('preview-fee-btn').style.display = 'none';
    document.getElementById('send-sol-btn').style.display = 'block';

    // Hide the status message since the preview box is now showing
    document.getElementById('status-message').style.display = 'none';

    console.log('Fee estimate:', feeInLamports, 'lamports =', feeInSOL, 'SOL');

  } catch (error) {
    console.error('Fee estimation failed:', error);
    showStatus('Fee estimation failed: ' + error.message, 'error');
  }
}


// ============================================================
// SEND SOL
// ============================================================
async function sendSOL() {
  try {
    const recipientAddressStr = document.getElementById('recipient-address').value.trim();
    const amountStr = document.getElementById('send-amount').value.trim();

    if (!recipientAddressStr) {
      showStatus('Please enter a recipient address.', 'error');
      return;
    }

    if (!amountStr || parseFloat(amountStr) <= 0) {
      showStatus('Please enter a valid amount greater than 0.', 'error');
      return;
    }

    const amountInSOL = parseFloat(amountStr);

    // Multiply by 1 billion to convert SOL to lamports
    // Math.floor removes any decimal since lamports must be whole numbers
    const amountInLamports = Math.floor(amountInSOL * 1000000000);

    // Validate the recipient address — PublicKey() throws if it's invalid
    let recipientPublicKey;
    try {
      recipientPublicKey = new window.solanaWeb3.PublicKey(recipientAddressStr);
    } catch (err) {
      showStatus('Invalid recipient address. Please double-check it.', 'error');
      return;
    }

    showStatus('Building transaction...', 'info');

    // Build the transaction with a SystemProgram transfer instruction
    const transaction = new window.solanaWeb3.Transaction();
    transaction.add(
      window.solanaWeb3.SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: recipientPublicKey,
        lamports: amountInLamports
      })
    );

    showStatus('Sending... please wait.', 'info');

    // Sign and send — this waits for confirmation before returning
    const txSignature = await window.solanaWeb3.sendAndConfirmTransaction(
      connection,
      transaction,
      [userKeypair]
    );

    console.log('Transaction confirmed! Signature:', txSignature);
    showStatus('Sent! TX: ' + txSignature, 'success');

    // Clear the form
    document.getElementById('recipient-address').value = '';
    document.getElementById('send-amount').value = '';

    // Reset the fee preview — hide it and show "Preview Fee" button again
    document.getElementById('fee-preview').style.display = 'none';
    document.getElementById('preview-fee-btn').style.display = 'block';
    document.getElementById('send-sol-btn').style.display = 'none';

    // Refresh balance and transactions after 2 seconds
    setTimeout(function () {
      refreshBalance();
      loadRecentTransactions();
    }, 2000);

  } catch (error) {
    console.error('Transaction failed:', error);
    showStatus('Transaction failed: ' + error.message, 'error');
  }
}


// ============================================================
// LOAD RECENT TRANSACTIONS
// ============================================================
async function loadRecentTransactions() {
  const txList = document.getElementById('tx-list');

  try {
    txList.innerHTML = '<li class="tx-loading">Loading transactions...</li>';

    // getSignaturesForAddress returns the last N transactions for this address
    const signatures = await connection.getSignaturesForAddress(
      userKeypair.publicKey,
      { limit: 5 }
    );

    if (signatures.length === 0) {
      txList.innerHTML = '<li class="tx-empty">No transactions yet.</li>';
      return;
    }

    txList.innerHTML = '';

    for (let i = 0; i < signatures.length; i++) {
      const fullSignature = signatures[i].signature;

      // Show first 5 + last 5 chars to keep it short
      const shortSignature = fullSignature.slice(0, 5) + '...' + fullSignature.slice(-5);

      // blockTime is seconds since epoch — multiply by 1000 for JS Date
      let timeString = 'Unknown time';
      if (signatures[i].blockTime) {
        timeString = new Date(signatures[i].blockTime * 1000).toLocaleString();
      }

      // Link to Solana Explorer on Devnet
      const explorerUrl = 'https://explorer.solana.com/tx/' + fullSignature + '?cluster=devnet';

      const listItem = document.createElement('li');
      listItem.innerHTML =
        '<div class="tx-left">' +
          '<div class="tx-icon">&#8599;</div>' +
          '<a class="tx-id" href="' + explorerUrl + '" target="_blank">' + shortSignature + '</a>' +
        '</div>' +
        '<span class="tx-time">' + timeString + '</span>';

      txList.appendChild(listItem);
    }

  } catch (error) {
    console.error('Error fetching transactions:', error);
    txList.innerHTML = '<li class="tx-empty">Could not load transactions.</li>';
  }
}


// ============================================================
// LOAD CONTACTS
// ============================================================
function loadContacts() {
  chrome.storage.local.get(['savedContacts'], function (result) {

    const contacts = result.savedContacts || [];

    // Rebuild the dropdown in the Send panel
    const dropdown = document.getElementById('contact-dropdown');
    dropdown.innerHTML = '<option value="">Select a saved contact...</option>';

    for (let i = 0; i < contacts.length; i++) {
      const option = document.createElement('option');
      option.textContent = contacts[i].name;
      option.value = contacts[i].address;
      dropdown.appendChild(option);
    }

    // Rebuild the contacts list in the Address Book panel
    const contactsList = document.getElementById('contacts-list');
    contactsList.innerHTML = '';

    if (contacts.length === 0) {
      contactsList.innerHTML = '<li class="contacts-empty">No contacts saved yet.</li>';
      return;
    }

    for (let i = 0; i < contacts.length; i++) {
      const li = document.createElement('li');
      li.className = 'contact-row';

      const shortAddr = contacts[i].address.slice(0, 6) + '...' + contacts[i].address.slice(-4);

      li.innerHTML =
        '<div class="contact-info">' +
          '<span class="contact-name">' + contacts[i].name + '</span>' +
          '<span class="contact-addr">' + shortAddr + '</span>' +
        '</div>' +
        '<button class="contact-delete-btn" data-index="' + i + '">&#10005;</button>';

      contactsList.appendChild(li);
    }

    // Wire up delete buttons
    const deleteButtons = document.querySelectorAll('.contact-delete-btn');
    for (let i = 0; i < deleteButtons.length; i++) {
      deleteButtons[i].addEventListener('click', function () {
        deleteContact(parseInt(this.getAttribute('data-index')));
      });
    }

  });
}


// ============================================================
// SAVE A CONTACT
// ============================================================
function saveContact() {
  const name = document.getElementById('contact-name').value.trim();
  const address = document.getElementById('contact-address').value.trim();

  if (!name) { alert('Please enter a contact name.'); return; }
  if (!address) { alert('Please enter a Solana address.'); return; }

  // Validate the address format
  try {
    new window.solanaWeb3.PublicKey(address);
  } catch (err) {
    alert('That doesn\'t look like a valid Solana address.');
    return;
  }

  chrome.storage.local.get(['savedContacts'], function (result) {
    const contacts = result.savedContacts || [];
    contacts.push({ name: name, address: address });

    chrome.storage.local.set({ savedContacts: contacts }, function () {
      document.getElementById('contact-name').value = '';
      document.getElementById('contact-address').value = '';
      loadContacts();
      alert('Contact "' + name + '" saved!');
    });
  });
}


// ============================================================
// DELETE A CONTACT
// ============================================================
function deleteContact(index) {
  chrome.storage.local.get(['savedContacts'], function (result) {
    const contacts = result.savedContacts || [];

    // splice(index, 1) removes the item at that position
    contacts.splice(index, 1);

    chrome.storage.local.set({ savedContacts: contacts }, function () {
      loadContacts();
    });
  });
}


// ============================================================
// UI HELPER: Reset the fee preview back to its default state
// ============================================================
// Called when the user edits the recipient or amount after already
// previewing the fee — forces them to re-estimate with the new values
function resetFeePreview() {
  document.getElementById('fee-preview').style.display = 'none';
  document.getElementById('preview-fee-btn').style.display = 'block';
  document.getElementById('send-sol-btn').style.display = 'none';
}


// ============================================================
// UI HELPER: Show the onboarding screen
// ============================================================
function showOnboardingScreen() {
  document.getElementById('onboarding-screen').style.display = 'flex';
  document.getElementById('wallet-screen').style.display = 'none';
}


// ============================================================
// UI HELPER: Show the main wallet screen
// ============================================================
function showWalletScreen() {
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('wallet-screen').style.display = 'block';

  if (userKeypair) {
    const fullAddress = userKeypair.publicKey.toString();
    document.getElementById('wallet-address').value = fullAddress;

    // Show shortened address in the pill: first 6 + ... + last 4
    const shortAddress = fullAddress.slice(0, 6) + '...' + fullAddress.slice(-4);
    document.getElementById('wallet-address-short').textContent = shortAddress;
  }
}


// ============================================================
// UI HELPER: Show a specific panel, hide all others
// ============================================================
// panelId can be: 'main-content', 'send-panel', 'contacts-panel', 'accounts-panel'
function showPanel(panelId) {
  // List of all panels that can be shown/hidden
  const allPanels = ['main-content', 'send-panel', 'contacts-panel', 'accounts-panel'];

  for (let i = 0; i < allPanels.length; i++) {
    const el = document.getElementById(allPanels[i]);
    if (el) {
      // Show the requested panel, hide everything else
      el.style.display = (allPanels[i] === panelId) ? 'block' : 'none';
    }
  }
}


// ============================================================
// UI HELPER: Copy wallet address to clipboard
// ============================================================
function copyAddress() {
  // Get the full address from the hidden input field
  const fullAddress = document.getElementById('wallet-address').value;

  // navigator.clipboard.writeText() is the modern way to copy text
  // It returns a Promise, so we use .then() for success and .catch() for errors
  navigator.clipboard.writeText(fullAddress).then(function () {
    // Copy worked!
    showStatus('Address copied!', 'success');
    setTimeout(function () {
      document.getElementById('status-message').style.display = 'none';
    }, 2000);

  }).catch(function (err) {
    // Copy failed — show the error
    console.error('Copy failed:', err);
    showStatus('Could not copy address.', 'error');
  });
}


// ============================================================
// UI HELPER: Show a status message
// ============================================================
// type: 'success', 'error', or 'info'
function showStatus(message, type) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;
  statusEl.className = type;
  statusEl.style.display = 'block';
}


// ============================================================
// SETUP: Wire up all button click events
// ============================================================
function setupButtonListeners() {

  // Onboarding — create first wallet
  document.getElementById('generate-wallet-btn').addEventListener('click', generateNewWallet);

  // Copy address pill button
  document.getElementById('copy-address-btn').addEventListener('click', copyAddress);

  // Refresh balance
  document.getElementById('refresh-balance-btn').addEventListener('click', refreshBalance);

  // Open Send panel
  document.getElementById('open-send-btn').addEventListener('click', function () {
    showPanel('send-panel');
  });

  // Close Send panel — also reset the fee preview
  document.getElementById('close-send-btn').addEventListener('click', function () {
    // Reset fee preview state so it's clean next time
    document.getElementById('fee-preview').style.display = 'none';
    document.getElementById('preview-fee-btn').style.display = 'block';
    document.getElementById('send-sol-btn').style.display = 'none';
    showPanel('main-content');
  });

  // Send SOL button (confirm step)
  document.getElementById('send-sol-btn').addEventListener('click', sendSOL);

  // Preview Fee button — estimates fee and shows the preview box
  document.getElementById('preview-fee-btn').addEventListener('click', estimateFee);

  // If the user changes the recipient or amount after previewing,
  // hide the fee preview and show "Preview Fee" again so they re-estimate
  document.getElementById('recipient-address').addEventListener('input', resetFeePreview);
  document.getElementById('send-amount').addEventListener('input', resetFeePreview);

  // Contact dropdown auto-fills recipient address
  document.getElementById('contact-dropdown').addEventListener('change', function () {    if (this.value !== '') {
      document.getElementById('recipient-address').value = this.value;
    }
  });

  // Open Contacts panel
  document.getElementById('open-contacts-btn').addEventListener('click', function () {
    showPanel('contacts-panel');
  });

  // Close Contacts panel
  document.getElementById('close-contacts-btn').addEventListener('click', function () {
    showPanel('main-content');
  });

  // Save contact button
  document.getElementById('save-contact-btn').addEventListener('click', saveContact);

  // Open Accounts panel (clicking the account name in the topbar)
  document.getElementById('open-accounts-btn').addEventListener('click', function () {
    loadAccountsList(); // Refresh the list before showing
    showPanel('accounts-panel');
  });

  // Close Accounts panel
  document.getElementById('close-accounts-btn').addEventListener('click', function () {
    showPanel('main-content');
  });

  // Add new account button
  document.getElementById('add-account-btn').addEventListener('click', addNewAccount);
}
