// ============================================================
// SIMPLE SOLANA WALLET - popup.js
// ============================================================
// This single file handles everything:
//   1. Loading an existing wallet from Chrome storage
//   2. Generating a brand new wallet
//   3. Fetching the SOL balance from Devnet
//   4. Sending a SOL transfer transaction
//
// We use the @solana/web3.js library loaded via CDN in popup.html
// It is available globally as window.solanaWeb3
// ============================================================


// ============================================================
// SETUP: Get the Solana library and create a connection
// ============================================================

// The local solana-web3.min.js file exposes the library as window.solanaWeb3
// We just use it directly via window.solanaWeb3 — no need to redeclare it

// Solana Devnet RPC endpoint
// This is a free public URL for testing - NOT for real money
const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

// Create a Connection object - this is how we talk to the blockchain
// 'confirmed' means we wait until the network has confirmed our transactions
const connection = new window.solanaWeb3.Connection(DEVNET_RPC_URL, 'confirmed');

// This variable will hold the user's Keypair (public + secret key)
// It starts as null until we load or generate a wallet
let userKeypair = null;


// ============================================================
// STEP 1: INITIALIZATION
// Runs automatically when the popup HTML finishes loading
// ============================================================
document.addEventListener('DOMContentLoaded', async function () {
  console.log('Popup opened. Checking Chrome storage for existing wallet...');

  // Try to load a saved wallet from Chrome's local storage
  await loadWalletFromStorage();

  // Wire up all the buttons to their handler functions
  setupButtonListeners();
});


// ============================================================
// STEP 2: LOAD WALLET FROM CHROME STORAGE
// ============================================================
// Chrome extensions can save data using chrome.storage.local
// We save the secret key as an array of numbers when we create a wallet
// Here we try to read it back
async function loadWalletFromStorage() {
  // chrome.storage.local.get is callback-based (not promise-based)
  // We pass it the key name we want to look up
  chrome.storage.local.get(['secretKey'], function (result) {

    if (result.secretKey) {
      // Found a saved secret key!
      console.log('Wallet found in storage. Loading it...');

      // The secret key was saved as a plain array of numbers like [12, 45, 200, ...]
      // We need to convert it back to a Uint8Array (typed array of bytes)
      const secretKeyBytes = new Uint8Array(result.secretKey);

      // Recreate the full Keypair from just the secret key bytes
      // The public key is mathematically derived from the secret key
      userKeypair = window.solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);

      console.log('Wallet loaded. Public key:', userKeypair.publicKey.toString());

      // Show the main wallet UI
      showWalletScreen();

      // Automatically fetch the balance when the wallet opens
      refreshBalance();

      // Load the 5 most recent transactions
      loadRecentTransactions();

      // Load saved contacts into the dropdown and contacts list
      loadContacts();

    } else {
      // No wallet found in storage - show the "create wallet" screen
      console.log('No wallet in storage. Showing onboarding screen.');
      showOnboardingScreen();
    }

  });
}


// ============================================================
// STEP 3: GENERATE A NEW WALLET
// ============================================================
// Called when the user clicks "Generate New Wallet"
async function generateNewWallet() {
  try {
    console.log('Generating a new Solana keypair...');

    // window.solanaWeb3.Keypair.generate() creates a random public/private key pair
    // The private key (secretKey) is 64 bytes
    // The public key (publicKey) is 32 bytes and is the wallet address
    userKeypair = window.solanaWeb3.Keypair.generate();

    console.log('New wallet created! Public key:', userKeypair.publicKey.toString());

    // Convert the Uint8Array secret key to a plain JavaScript array
    // We do this because Chrome storage works best with plain JSON-serializable values
    const secretKeyAsArray = Array.from(userKeypair.secretKey);

    // Save the secret key array to Chrome's local storage
    // This persists even when the popup is closed
    chrome.storage.local.set({ secretKey: secretKeyAsArray }, function () {
      console.log('Secret key saved to Chrome storage.');

      // Now show the main wallet screen
      showWalletScreen();

      // Fetch balance (will be 0 for a brand new wallet)
      refreshBalance();

      // Load recent transactions (will be empty for a new wallet)
      loadRecentTransactions();

      // Load contacts (will be empty for a new wallet)
      loadContacts();
    });

  } catch (error) {
    console.error('Failed to generate wallet:', error);
    showStatus('Error generating wallet: ' + error.message, 'error');
  }
}


// ============================================================
// STEP 4: REFRESH BALANCE
// ============================================================
// Fetches the current SOL balance for our wallet address from Devnet
async function refreshBalance() {
  try {
    // Make sure we have a wallet loaded before trying to check balance
    if (!userKeypair) {
      showStatus('No wallet loaded.', 'error');
      return;
    }

    showStatus('Fetching balance from Devnet...', 'info');
    console.log('Fetching balance for:', userKeypair.publicKey.toString());

    // connection.getBalance() takes a PublicKey and returns the balance in LAMPORTS
    // Lamports are the smallest unit of SOL, like cents are to dollars
    // 1 SOL = 1,000,000,000 lamports (one billion)
    const balanceInLamports = await connection.getBalance(userKeypair.publicKey);

    // Convert lamports to SOL by dividing by 1 billion
    // Example: 500,000,000 lamports / 1,000,000,000 = 0.5 SOL
    const balanceInSOL = balanceInLamports / 1000000000;

    console.log('Balance:', balanceInLamports, 'lamports =', balanceInSOL, 'SOL');

    // Update the balance display in the UI
    // toFixed(4) shows 4 decimal places, e.g. "1.2345"
    document.getElementById('balance-amount').textContent = balanceInSOL.toFixed(4);

    // Show a brief success message then hide it
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
// STEP 5: SEND SOL
// ============================================================
// Reads the form inputs, builds a transaction, signs it, and sends it
async function sendSOL() {
  try {
    // --- Read inputs from the form ---
    const recipientAddressStr = document.getElementById('recipient-address').value.trim();
    const amountStr = document.getElementById('send-amount').value.trim();

    // --- Basic validation ---
    if (!recipientAddressStr) {
      showStatus('Please enter a recipient address.', 'error');
      return;
    }

    if (!amountStr || parseFloat(amountStr) <= 0) {
      showStatus('Please enter a valid amount greater than 0.', 'error');
      return;
    }

    const amountInSOL = parseFloat(amountStr);

    // Convert SOL to lamports (multiply by 1 billion)
    // Math.floor() removes any decimal remainder since lamports must be whole numbers
    const amountInLamports = Math.floor(amountInSOL * 1000000000);

    console.log('Preparing to send', amountInSOL, 'SOL (', amountInLamports, 'lamports)');
    console.log('Recipient:', recipientAddressStr);

    // --- Validate the recipient address ---
    // new window.solanaWeb3.PublicKey() will throw an error if the string is not a valid address
    let recipientPublicKey;
    try {
      recipientPublicKey = new window.solanaWeb3.PublicKey(recipientAddressStr);
    } catch (err) {
      // The address string was not a valid Solana public key
      showStatus('Invalid recipient address. Please double-check it.', 'error');
      return;
    }

    showStatus('Building transaction...', 'info');

    // --- Build the transaction ---
    // A Transaction is a container that holds one or more instructions
    const transaction = new window.solanaWeb3.Transaction();

    // SystemProgram.transfer() creates an instruction that moves SOL
    // from one account to another. This is a built-in Solana program,
    // no custom smart contract needed.
    const transferInstruction = window.solanaWeb3.SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,  // Our wallet (the sender)
      toPubkey: recipientPublicKey,        // The recipient's wallet
      lamports: amountInLamports           // How much to send (in lamports)
    });

    // Add the transfer instruction to our transaction
    transaction.add(transferInstruction);

    showStatus('Sending transaction... please wait.', 'info');

    // --- Sign and send the transaction ---
    // sendAndConfirmTransaction does three things:
    //   1. Signs the transaction with our keypair (proves we own the wallet)
    //   2. Sends it to the Solana network
    //   3. Waits until the network confirms it was processed
    // It returns a "signature" which is the unique transaction ID
    const txSignature = await window.solanaWeb3.sendAndConfirmTransaction(
      connection,
      transaction,
      [userKeypair]  // Array of signers - just us in this case
    );

    console.log('Transaction confirmed! Signature:', txSignature);

    // Show the transaction ID to the user
    // They can look it up on https://explorer.solana.com/?cluster=devnet
    showStatus('Success! Transaction ID:\n' + txSignature, 'success');

    // Clear the form inputs
    document.getElementById('recipient-address').value = '';
    document.getElementById('send-amount').value = '';

    // Wait 2 seconds then refresh the balance and transaction list
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
// STEP 6: LOAD RECENT TRANSACTIONS
// ============================================================
// Fetches the 5 most recent transactions for our wallet address
// and displays them as clickable links in the #tx-list element
async function loadRecentTransactions() {
  // Get the <ul> element where we'll put the transaction list items
  const txList = document.getElementById('tx-list');

  try {
    console.log('Fetching recent transactions...');

    // Show a loading message while we wait for the network
    txList.innerHTML = '<li class="tx-loading">Loading transactions...</li>';

    // getSignaturesForAddress() asks Solana for a list of recent transactions
    // that involve our wallet address.
    // The { limit: 5 } option means "only give me the 5 most recent ones"
    // Each item in the returned array has a .signature (the transaction ID)
    // and a .blockTime (unix timestamp of when it happened)
    const signatures = await connection.getSignaturesForAddress(
      userKeypair.publicKey,
      { limit: 5 }
    );

    console.log('Got', signatures.length, 'transactions');

    // If there are no transactions yet, show a friendly message
    if (signatures.length === 0) {
      txList.innerHTML = '<li class="tx-empty">No transactions yet.</li>';
      return;
    }

    // Clear the loading message so we can fill in the real data
    txList.innerHTML = '';

    // Loop through each transaction in the array
    // signatures[0] is the most recent, signatures[4] is the oldest
    for (let i = 0; i < signatures.length; i++) {

      // The full transaction signature looks like:
      // "5KtPn1LGuxhFiwjxqUBpnzFLJBPbRBsHqNrTJBkS7dKvXyz..."
      // It's 88 characters long — too long to show in full.
      // So we show the first 5 chars + "..." + last 5 chars
      // Example: "5KtPn...7dKvX"
      const fullSignature = signatures[i].signature;
      const shortSignature = fullSignature.slice(0, 5) + '...' + fullSignature.slice(-5);

      // blockTime is a Unix timestamp (seconds since Jan 1 1970)
      // We convert it to a readable date string
      // If blockTime is null (rare), we show "Unknown time"
      let timeString = 'Unknown time';
      if (signatures[i].blockTime) {
        // Multiply by 1000 because JavaScript Date uses milliseconds
        const date = new Date(signatures[i].blockTime * 1000);

        // toLocaleString() gives us something like "5/19/2026, 3:45:00 PM"
        timeString = date.toLocaleString();
      }

      // Build the Solana Explorer URL for this transaction
      // Adding ?cluster=devnet tells Explorer to look on Devnet, not Mainnet
      const explorerUrl = 'https://explorer.solana.com/tx/' + fullSignature + '?cluster=devnet';

      // Create a new <li> element for this transaction
      const listItem = document.createElement('li');

      // Build the row: left side has icon + link, right side has timestamp
      listItem.innerHTML =
        '<div class="tx-left">' +
          '<div class="tx-icon">&#8599;</div>' +
          '<a class="tx-id" href="' + explorerUrl + '" target="_blank">' + shortSignature + '</a>' +
        '</div>' +
        '<span class="tx-time">' + timeString + '</span>';

      // Add this list item to the <ul>
      txList.appendChild(listItem);
    }

  } catch (error) {
    console.error('Error fetching transactions:', error);
    // Show the error inside the list so the user knows something went wrong
    txList.innerHTML = '<li class="tx-empty">Could not load transactions.</li>';
  }
}


// ============================================================
// STEP 7: LOAD CONTACTS
// ============================================================
// Reads saved contacts from Chrome storage and:
//   1. Populates the dropdown in the Send panel
//   2. Populates the contacts list in the Address Book panel
function loadContacts() {
  // Ask Chrome storage for the 'savedContacts' key
  // If it doesn't exist yet, default to an empty array []
  chrome.storage.local.get(['savedContacts'], function (result) {

    // If nothing is saved yet, use an empty array
    const contacts = result.savedContacts || [];

    console.log('Loaded', contacts.length, 'contacts from storage');

    // --- Update the dropdown in the Send panel ---
    const dropdown = document.getElementById('contact-dropdown');

    // Clear all existing options first, then add the default placeholder back
    dropdown.innerHTML = '<option value="">Select a saved contact...</option>';

    // Loop through each saved contact and add it as an <option>
    // The option text shows the name, the value holds the address
    // So when the user picks "Alice", the value is Alice's public key
    for (let i = 0; i < contacts.length; i++) {
      const option = document.createElement('option');
      option.textContent = contacts[i].name;   // What the user sees
      option.value = contacts[i].address;       // The actual wallet address
      dropdown.appendChild(option);
    }

    // --- Update the contacts list in the Address Book panel ---
    const contactsList = document.getElementById('contacts-list');
    contactsList.innerHTML = '';

    if (contacts.length === 0) {
      // No contacts saved yet — show a placeholder message
      contactsList.innerHTML = '<li class="contacts-empty">No contacts saved yet.</li>';
      return;
    }

    // Build a list item for each contact showing their name and shortened address
    for (let i = 0; i < contacts.length; i++) {
      const li = document.createElement('li');
      li.className = 'contact-row';

      // Shorten the address for display: first 6 + ... + last 4 chars
      const shortAddr = contacts[i].address.slice(0, 6) + '...' + contacts[i].address.slice(-4);

      li.innerHTML =
        '<div class="contact-info">' +
          '<span class="contact-name">' + contacts[i].name + '</span>' +
          '<span class="contact-addr">' + shortAddr + '</span>' +
        '</div>' +
        // Delete button — stores the index so we know which contact to remove
        '<button class="contact-delete-btn" data-index="' + i + '">&#10005;</button>';

      contactsList.appendChild(li);
    }

    // Add click listeners to all the delete buttons we just created
    // We do this here because the buttons didn't exist before this function ran
    const deleteButtons = document.querySelectorAll('.contact-delete-btn');
    for (let i = 0; i < deleteButtons.length; i++) {
      deleteButtons[i].addEventListener('click', function () {
        // data-index tells us which contact in the array to remove
        const indexToDelete = parseInt(this.getAttribute('data-index'));
        deleteContact(indexToDelete);
      });
    }

  });
}


// ============================================================
// STEP 8: SAVE A CONTACT
// ============================================================
// Reads the name + address inputs, validates them, and saves to storage
function saveContact() {
  // Read the input values and trim whitespace
  const name = document.getElementById('contact-name').value.trim();
  const address = document.getElementById('contact-address').value.trim();

  // Basic validation — both fields must be filled in
  if (!name) {
    alert('Please enter a contact name.');
    return;
  }

  if (!address) {
    alert('Please enter a Solana address.');
    return;
  }

  // Validate that the address is actually a valid Solana public key
  // new window.solanaWeb3.PublicKey() throws an error if the string is invalid
  try {
    new window.solanaWeb3.PublicKey(address);
  } catch (err) {
    alert('That doesn\'t look like a valid Solana address. Please double-check it.');
    return;
  }

  // Load the existing contacts array from storage first
  // We need to add to it, not overwrite it
  chrome.storage.local.get(['savedContacts'], function (result) {

    // Get existing contacts, or start with empty array if none saved yet
    const contacts = result.savedContacts || [];

    // Add the new contact object to the array
    // Each contact is just { name: "Alice", address: "ABC123..." }
    contacts.push({ name: name, address: address });

    // Save the updated array back to Chrome storage
    // JSON.stringify is NOT needed here — chrome.storage handles objects natively
    chrome.storage.local.set({ savedContacts: contacts }, function () {
      console.log('Contact saved:', name, address);

      // Clear the input fields
      document.getElementById('contact-name').value = '';
      document.getElementById('contact-address').value = '';

      // Refresh the contacts list and dropdown to show the new contact
      loadContacts();

      // Let the user know it worked
      alert('Contact "' + name + '" saved!');
    });

  });
}


// ============================================================
// STEP 9: DELETE A CONTACT
// ============================================================
// Removes a contact at a given index from the saved array
function deleteContact(index) {
  chrome.storage.local.get(['savedContacts'], function (result) {
    const contacts = result.savedContacts || [];

    // splice(index, 1) removes 1 item at the given position
    // e.g. if index is 2, it removes contacts[2]
    contacts.splice(index, 1);

    // Save the updated array (now one item shorter) back to storage
    chrome.storage.local.set({ savedContacts: contacts }, function () {
      console.log('Contact deleted at index', index);

      // Refresh the list to reflect the deletion
      loadContacts();
    });
  });
}


// ============================================================
// UI HELPER: Show the onboarding screen
// ============================================================
function showOnboardingScreen() {
  document.getElementById('onboarding-screen').style.display = 'block';
  document.getElementById('wallet-screen').style.display = 'none';
}


// ============================================================
// UI HELPER: Show the main wallet screen
// ============================================================
function showWalletScreen() {
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('wallet-screen').style.display = 'block';

  // Fill in the wallet address
  if (userKeypair) {
    const fullAddress = userKeypair.publicKey.toString();

    // Put the full address in the hidden input (used for copying)
    document.getElementById('wallet-address').value = fullAddress;

    // Show a shortened version in the visible address bar
    // e.g. "HnAz4...dQzY" — first 6 chars + ... + last 4 chars
    const shortAddress = fullAddress.slice(0, 6) + '...' + fullAddress.slice(-4);
    document.getElementById('wallet-address-short').textContent = shortAddress;
  }
}


// ============================================================
// UI HELPER: Copy wallet address to clipboard
// ============================================================
function copyAddress() {
  const addressInput = document.getElementById('wallet-address');

  // Select all text in the input field
  addressInput.select();
  addressInput.setSelectionRange(0, 99999); // For mobile compatibility

  // Copy the selected text to clipboard
  document.execCommand('copy');

  showStatus('Address copied to clipboard!', 'success');

  // Hide the message after 2 seconds
  setTimeout(function () {
    document.getElementById('status-message').style.display = 'none';
  }, 2000);
}


// ============================================================
// UI HELPER: Show a status/feedback message
// ============================================================
// message: the text to display
// type: 'success' (green), 'error' (red), or 'info' (blue)
function showStatus(message, type) {
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message;

  // Remove any previous type class and set the new one
  // The CSS file has styles for .success, .error, and .info
  statusEl.className = type;

  // Make sure it's visible
  statusEl.style.display = 'block';
}


// ============================================================
// SETUP: Wire up all button click events
// ============================================================
function setupButtonListeners() {
  // "Create Wallet" button on the onboarding screen
  document.getElementById('generate-wallet-btn').addEventListener('click', generateNewWallet);

  // "Copy" button next to the wallet address
  document.getElementById('copy-address-btn').addEventListener('click', copyAddress);

  // "Refresh" action button
  document.getElementById('refresh-balance-btn').addEventListener('click', refreshBalance);

  // "Send" action button — shows the send panel
  document.getElementById('open-send-btn').addEventListener('click', function () {
    document.getElementById('send-panel').style.display = 'block';
    document.getElementById('contacts-panel').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
  });

  // "Back" button inside send panel — hides it again
  document.getElementById('close-send-btn').addEventListener('click', function () {
    document.getElementById('send-panel').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
  });

  // "Send SOL" submit button inside the send panel
  document.getElementById('send-sol-btn').addEventListener('click', sendSOL);

  // "Contacts" action button — shows the address book panel
  document.getElementById('open-contacts-btn').addEventListener('click', function () {
    document.getElementById('contacts-panel').style.display = 'block';
    document.getElementById('send-panel').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
  });

  // "Back" button inside contacts panel
  document.getElementById('close-contacts-btn').addEventListener('click', function () {
    document.getElementById('contacts-panel').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
  });

  // "Save Contact" button inside the address book panel
  document.getElementById('save-contact-btn').addEventListener('click', saveContact);

  // Contact dropdown — when user picks a contact, auto-fill the recipient address
  document.getElementById('contact-dropdown').addEventListener('change', function () {
    // this.value is the wallet address stored in the selected <option>
    // If the user picked the placeholder "Select a saved contact...", value is ""
    if (this.value !== '') {
      document.getElementById('recipient-address').value = this.value;
    }
  });
}
