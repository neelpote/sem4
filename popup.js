// Solana Devnet connection
const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const connection = new window.solanaWeb3.Connection(DEVNET_RPC_URL, 'confirmed');

let userKeypair = null;
let activeAccountIndex = 0;

// ---- INIT ----

document.addEventListener('DOMContentLoaded', async function () {
  await loadWalletFromStorage();
  setupButtonListeners();
});

function loadWalletFromStorage() {
  chrome.storage.local.get(['allAccounts', 'activeAccountIndex'], function (result) {
    if (result.allAccounts && result.allAccounts.length > 0) {
      activeAccountIndex = result.activeAccountIndex || 0;
      if (activeAccountIndex >= result.allAccounts.length) activeAccountIndex = 0;
      loadKeypairAtIndex(result.allAccounts, activeAccountIndex);
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadContacts();
      loadAccountsList();
      fetchSolPrice();
      fetchAndDrawChart();
    } else {
      showOnboardingScreen();
    }
  });
}

function loadKeypairAtIndex(allAccounts, index) {
  const secretKeyBytes = new Uint8Array(allAccounts[index].secretKey);
  userKeypair = window.solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);
}

// ---- WALLET CREATION ----

async function generateNewWallet() {
  try {
    const newKeypair = window.solanaWeb3.Keypair.generate();
    const newAccount = { name: 'Account 1', secretKey: Array.from(newKeypair.secretKey) };

    chrome.storage.local.set({ allAccounts: [newAccount], activeAccountIndex: 0 }, function () {
      userKeypair = newKeypair;
      activeAccountIndex = 0;
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadContacts();
      loadAccountsList();
      fetchSolPrice();
      fetchAndDrawChart();
    });
  } catch (error) {
    showStatus('Error creating wallet: ' + error.message, 'error');
  }
}

// ---- ACCOUNTS ----

function addNewAccount() {
  chrome.storage.local.get(['allAccounts'], function (result) {
    const allAccounts = result.allAccounts || [];
    const newKeypair = window.solanaWeb3.Keypair.generate();
    const newAccount = {
      name: 'Account ' + (allAccounts.length + 1),
      secretKey: Array.from(newKeypair.secretKey)
    };
    allAccounts.push(newAccount);
    const newIndex = allAccounts.length - 1;

    chrome.storage.local.set({ allAccounts: allAccounts, activeAccountIndex: newIndex }, function () {
      userKeypair = newKeypair;
      activeAccountIndex = newIndex;
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadAccountsList();
      showPanel('main-content');
    });
  });
}

function switchToAccount(index) {
  chrome.storage.local.get(['allAccounts'], function (result) {
    const allAccounts = result.allAccounts || [];
    if (index < 0 || index >= allAccounts.length) return;

    chrome.storage.local.set({ activeAccountIndex: index }, function () {
      activeAccountIndex = index;
      loadKeypairAtIndex(allAccounts, index);
      showWalletScreen();
      refreshBalance();
      loadRecentTransactions();
      loadAccountsList();
      showPanel('main-content');
    });
  });
}

function loadAccountsList() {
  chrome.storage.local.get(['allAccounts', 'activeAccountIndex'], function (result) {
    const allAccounts = result.allAccounts || [];
    const currentIndex = result.activeAccountIndex || 0;

    if (allAccounts[currentIndex]) {
      document.getElementById('active-account-name').textContent = allAccounts[currentIndex].name;
    }

    const accountsList = document.getElementById('accounts-list');
    accountsList.innerHTML = '';

    for (let i = 0; i < allAccounts.length; i++) {
      const kp = window.solanaWeb3.Keypair.fromSecretKey(new Uint8Array(allAccounts[i].secretKey));
      const addr = kp.publicKey.toString();
      const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
      const isActive = (i === currentIndex);

      const li = document.createElement('li');
      li.className = 'account-row' + (isActive ? ' account-row-active' : '');
      li.innerHTML =
        '<div class="account-info">' +
          '<span class="account-name">' + allAccounts[i].name + '</span>' +
          '<span class="account-addr">' + shortAddr + '</span>' +
        '</div>' +
        (isActive
          ? '<span class="account-active-badge">&#10003; Active</span>'
          : '<button class="account-switch-btn" data-index="' + i + '">Switch</button>');
      accountsList.appendChild(li);
    }

    document.querySelectorAll('.account-switch-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchToAccount(parseInt(this.getAttribute('data-index')));
      });
    });
  });
}

// ---- BALANCE ----

async function refreshBalance() {
  try {
    if (!userKeypair) return;
    showStatus('Fetching balance...', 'info');

    // getBalance returns lamports — divide by 1,000,000,000 to get SOL
    const lamports = await connection.getBalance(userKeypair.publicKey);
    document.getElementById('balance-amount').textContent = (lamports / 1000000000).toFixed(4);

    showStatus('Balance updated!', 'success');
    setTimeout(function () {
      document.getElementById('status-message').style.display = 'none';
    }, 2000);
  } catch (error) {
    showStatus('Could not fetch balance: ' + error.message, 'error');
  }
}

// ---- FEE ESTIMATION ----

async function estimateFee() {
  try {
    const recipientAddressStr = document.getElementById('recipient-address').value.trim();
    const amountStr = document.getElementById('send-amount').value.trim();

    if (!recipientAddressStr) { showStatus('Please enter a recipient address first.', 'error'); return; }
    if (!amountStr || parseFloat(amountStr) <= 0) { showStatus('Please enter a valid amount first.', 'error'); return; }

    const amountInSOL = parseFloat(amountStr);
    const amountInLamports = Math.floor(amountInSOL * 1000000000);

    let recipientPublicKey;
    try {
      recipientPublicKey = new window.solanaWeb3.PublicKey(recipientAddressStr);
    } catch (err) {
      showStatus('Invalid recipient address.', 'error');
      return;
    }

    showStatus('Estimating fee...', 'info');

    // Get a fresh blockhash — required for every Solana transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // Build the transaction message without signing it
    // getFeeForMessage() tells us the cost before we commit
    const message = new window.solanaWeb3.TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [window.solanaWeb3.SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: recipientPublicKey,
        lamports: amountInLamports
      })]
    }).compileToV0Message();

    const feeResponse = await connection.getFeeForMessage(message, 'confirmed');
    const feeInLamports = feeResponse.value;

    if (feeInLamports === null) { showStatus('Could not estimate fee. Try again.', 'error'); return; }

    const feeInSOL = feeInLamports / 1000000000;
    const totalInSOL = amountInSOL + feeInSOL;

    document.getElementById('fee-amount-display').textContent = amountInSOL.toFixed(6) + ' SOL';
    document.getElementById('fee-estimate-display').textContent = feeInSOL.toFixed(6) + ' SOL';
    document.getElementById('fee-total-display').textContent = totalInSOL.toFixed(6) + ' SOL';

    document.getElementById('fee-preview').style.display = 'block';
    document.getElementById('preview-fee-btn').style.display = 'none';
    document.getElementById('send-sol-btn').style.display = 'block';
    document.getElementById('status-message').style.display = 'none';

  } catch (error) {
    showStatus('Fee estimation failed: ' + error.message, 'error');
  }
}

// ---- SEND SOL ----

async function sendSOL() {
  try {
    const recipientAddressStr = document.getElementById('recipient-address').value.trim();
    const amountStr = document.getElementById('send-amount').value.trim();

    if (!recipientAddressStr) { showStatus('Please enter a recipient address.', 'error'); return; }
    if (!amountStr || parseFloat(amountStr) <= 0) { showStatus('Please enter a valid amount.', 'error'); return; }

    const amountInLamports = Math.floor(parseFloat(amountStr) * 1000000000);

    let recipientPublicKey;
    try {
      recipientPublicKey = new window.solanaWeb3.PublicKey(recipientAddressStr);
    } catch (err) {
      showStatus('Invalid recipient address.', 'error');
      return;
    }

    showStatus('Sending... please wait.', 'info');

    const transaction = new window.solanaWeb3.Transaction();
    transaction.add(window.solanaWeb3.SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: recipientPublicKey,
      lamports: amountInLamports
    }));

    const txSignature = await window.solanaWeb3.sendAndConfirmTransaction(connection, transaction, [userKeypair]);

    showStatus('Sent! TX: ' + txSignature, 'success');

    document.getElementById('recipient-address').value = '';
    document.getElementById('send-amount').value = '';
    resetFeePreview();

    setTimeout(function () { refreshBalance(); loadRecentTransactions(); }, 2000);

  } catch (error) {
    showStatus('Transaction failed: ' + error.message, 'error');
  }
}

// ---- TRANSACTIONS ----

async function loadRecentTransactions() {
  const txList = document.getElementById('tx-list');
  try {
    txList.innerHTML = '<li class="tx-loading">Loading transactions...</li>';

    const signatures = await connection.getSignaturesForAddress(userKeypair.publicKey, { limit: 5 });

    if (signatures.length === 0) {
      txList.innerHTML = '<li class="tx-empty">No transactions yet.</li>';
      return;
    }

    txList.innerHTML = '';
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i].signature;
      const short = sig.slice(0, 5) + '...' + sig.slice(-5);
      const time = signatures[i].blockTime
        ? new Date(signatures[i].blockTime * 1000).toLocaleString()
        : 'Unknown';
      const url = 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet';

      const li = document.createElement('li');
      li.innerHTML =
        '<div class="tx-left"><div class="tx-icon">&#8599;</div>' +
        '<a class="tx-id" href="' + url + '" target="_blank">' + short + '</a></div>' +
        '<span class="tx-time">' + time + '</span>';
      txList.appendChild(li);
    }
  } catch (error) {
    txList.innerHTML = '<li class="tx-empty">Could not load transactions.</li>';
  }
}

// ---- CONTACTS ----

function loadContacts() {
  chrome.storage.local.get(['savedContacts'], function (result) {
    const contacts = result.savedContacts || [];

    const dropdown = document.getElementById('contact-dropdown');
    dropdown.innerHTML = '<option value="">Select a saved contact...</option>';
    contacts.forEach(function (c) {
      const opt = document.createElement('option');
      opt.textContent = c.name;
      opt.value = c.address;
      dropdown.appendChild(opt);
    });

    const list = document.getElementById('contacts-list');
    list.innerHTML = '';

    if (contacts.length === 0) {
      list.innerHTML = '<li class="contacts-empty">No contacts saved yet.</li>';
      return;
    }

    contacts.forEach(function (c, i) {
      const li = document.createElement('li');
      li.className = 'contact-row';
      li.innerHTML =
        '<div class="contact-info">' +
          '<span class="contact-name">' + c.name + '</span>' +
          '<span class="contact-addr">' + c.address.slice(0, 6) + '...' + c.address.slice(-4) + '</span>' +
        '</div>' +
        '<button class="contact-delete-btn" data-index="' + i + '">&#10005;</button>';
      list.appendChild(li);
    });

    document.querySelectorAll('.contact-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteContact(parseInt(this.getAttribute('data-index')));
      });
    });
  });
}

function saveContact() {
  const name = document.getElementById('contact-name').value.trim();
  const address = document.getElementById('contact-address').value.trim();

  if (!name) { alert('Please enter a contact name.'); return; }
  if (!address) { alert('Please enter a Solana address.'); return; }

  try { new window.solanaWeb3.PublicKey(address); }
  catch (err) { alert('Invalid Solana address.'); return; }

  chrome.storage.local.get(['savedContacts'], function (result) {
    const contacts = result.savedContacts || [];
    contacts.push({ name, address });
    chrome.storage.local.set({ savedContacts: contacts }, function () {
      document.getElementById('contact-name').value = '';
      document.getElementById('contact-address').value = '';
      loadContacts();
      alert('Contact "' + name + '" saved!');
    });
  });
}

function deleteContact(index) {
  chrome.storage.local.get(['savedContacts'], function (result) {
    const contacts = result.savedContacts || [];
    contacts.splice(index, 1);
    chrome.storage.local.set({ savedContacts: contacts }, loadContacts);
  });
}

// ---- PRICE & CHART ----

async function fetchSolPrice() {
  try {
    const response = await fetch('http://localhost:3000/api/prices');
    if (!response.ok) throw new Error('Server error');
    const data = await response.json();
    const usd = data.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const inr = data.inr.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    document.getElementById('sol-price-display').textContent = '1 SOL = $' + usd + ' · ₹' + inr;
  } catch (error) {
    document.getElementById('sol-price-display').textContent = 'Price unavailable';
  }
}

async function fetchAndDrawChart() {
  try {
    let prices = null;

    // Try local server first, fall back to CoinGecko
    try {
      const res = await fetch('http://localhost:3000/api/history');
      if (res.ok) {
        const data = await res.json();
        if (data.prices && data.prices.length > 0) prices = data.prices;
      }
    } catch (e) {}

    if (!prices) {
      const res = await fetch('https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7');
      if (!res.ok) throw new Error('CoinGecko error');
      const data = await res.json();
      // Each item is [timestamp, price] — we only need the price (index 1)
      prices = data.prices.map(function (p) { return p[1]; });
    }

    if (!prices || prices.length === 0) return;

    const current = prices[prices.length - 1];
    const change = ((current - prices[0]) / prices[0]) * 100;
    const sign = change >= 0 ? '+' : '';

    document.getElementById('chart-current-price').textContent =
      '$' + current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const changeEl = document.getElementById('chart-change');
    changeEl.textContent = sign + change.toFixed(2) + '%';
    changeEl.className = 'chart-change ' + (change >= 0 ? 'chart-change-up' : 'chart-change-down');

    drawLineChart(prices);

  } catch (error) {
    document.getElementById('chart-current-price').textContent = 'Unavailable';
  }
}

function drawLineChart(prices) {
  const canvas = document.getElementById('price-chart');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, P = 8;

  ctx.clearRect(0, 0, W, H);

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  // Convert a price to a Y pixel (canvas Y is inverted — top is 0)
  function toY(price) { return H - P - ((price - min) / range) * (H - P * 2); }
  function toX(i) { return P + (i / (prices.length - 1)) * (W - P * 2); }

  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? '#4ade80' : '#f87171';

  // Gradient fill under the line
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, isUp ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  // Draw filled area
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < prices.length; i++) {
    const mx = (toX(i - 1) + toX(i)) / 2;
    ctx.quadraticCurveTo(toX(i - 1), toY(prices[i - 1]), mx, (toY(prices[i - 1]) + toY(prices[i])) / 2);
  }
  ctx.lineTo(toX(prices.length - 1), toY(prices[prices.length - 1]));
  ctx.lineTo(toX(prices.length - 1), H);
  ctx.lineTo(toX(0), H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw the line
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(prices[0]));
  for (let i = 1; i < prices.length; i++) {
    const mx = (toX(i - 1) + toX(i)) / 2;
    ctx.quadraticCurveTo(toX(i - 1), toY(prices[i - 1]), mx, (toY(prices[i - 1]) + toY(prices[i])) / 2);
  }
  ctx.lineTo(toX(prices.length - 1), toY(prices[prices.length - 1]));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Dot at the latest price
  ctx.beginPath();
  ctx.arc(toX(prices.length - 1), toY(prices[prices.length - 1]), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ---- UI HELPERS ----

function showOnboardingScreen() {
  document.getElementById('onboarding-screen').style.display = 'flex';
  document.getElementById('wallet-screen').style.display = 'none';
}

function showWalletScreen() {
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('wallet-screen').style.display = 'block';
  if (userKeypair) {
    const addr = userKeypair.publicKey.toString();
    document.getElementById('wallet-address').value = addr;
    document.getElementById('wallet-address-short').textContent = addr.slice(0, 6) + '...' + addr.slice(-4);
  }
}

function showPanel(panelId) {
  ['main-content', 'send-panel', 'contacts-panel', 'accounts-panel'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = id === panelId ? 'block' : 'none';
  });
}

function resetFeePreview() {
  document.getElementById('fee-preview').style.display = 'none';
  document.getElementById('preview-fee-btn').style.display = 'block';
  document.getElementById('send-sol-btn').style.display = 'none';
}

function copyAddress() {
  navigator.clipboard.writeText(document.getElementById('wallet-address').value)
    .then(function () {
      showStatus('Address copied!', 'success');
      setTimeout(function () { document.getElementById('status-message').style.display = 'none'; }, 2000);
    })
    .catch(function () { showStatus('Could not copy address.', 'error'); });
}

function showStatus(message, type) {
  const el = document.getElementById('status-message');
  el.textContent = message;
  el.className = type;
  el.style.display = 'block';
}

// ---- BUTTON LISTENERS ----

function setupButtonListeners() {
  document.getElementById('generate-wallet-btn').addEventListener('click', generateNewWallet);
  document.getElementById('copy-address-btn').addEventListener('click', copyAddress);
  document.getElementById('refresh-balance-btn').addEventListener('click', refreshBalance);

  document.getElementById('open-send-btn').addEventListener('click', function () { showPanel('send-panel'); });
  document.getElementById('close-send-btn').addEventListener('click', function () { resetFeePreview(); showPanel('main-content'); });
  document.getElementById('send-sol-btn').addEventListener('click', sendSOL);
  document.getElementById('preview-fee-btn').addEventListener('click', estimateFee);
  document.getElementById('recipient-address').addEventListener('input', resetFeePreview);
  document.getElementById('send-amount').addEventListener('input', resetFeePreview);
  document.getElementById('contact-dropdown').addEventListener('change', function () {
    if (this.value) document.getElementById('recipient-address').value = this.value;
  });

  document.getElementById('open-contacts-btn').addEventListener('click', function () { showPanel('contacts-panel'); });
  document.getElementById('close-contacts-btn').addEventListener('click', function () { showPanel('main-content'); });
  document.getElementById('save-contact-btn').addEventListener('click', saveContact);

  document.getElementById('open-accounts-btn').addEventListener('click', function () { loadAccountsList(); showPanel('accounts-panel'); });
  document.getElementById('close-accounts-btn').addEventListener('click', function () { showPanel('main-content'); });
  document.getElementById('add-account-btn').addEventListener('click', addNewAccount);
}
