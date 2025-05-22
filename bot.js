
// Final Hedera Telegram Wallet Bot - Full Code
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const {
    Client,
    AccountId,
    PrivateKey,
    AccountCreateTransaction,
    Hbar,
    TransferTransaction,
    AccountDeleteTransaction,
    TokenAssociateTransaction,
    AccountBalanceQuery,
    AccountInfoQuery
} = require("@hashgraph/sdk");
const axios = require("axios");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const operatorId = AccountId.fromString(process.env.OPERATOR_ID);
const operatorKey = PrivateKey.fromString(process.env.OPERATOR_KEY);
const client = Client.forTestnet();
client.setOperator(operatorId, operatorKey);

const userWallets = {};

// /start command with inline button
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `👋 <b>Welcome to Hedera Temporary Wallet Bot!</b>\n\nClick the Start button below to begin.`, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[{ text: "🚀 Start", callback_data: "show_commands" }]]
        }
    });
});

// Inline start button response
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (query.data === "show_commands") {
        await bot.sendMessage(chatId, `🚀 <b>Welcome to Hedera Temporary Wallet Bot!</b>\n\n<b>Available Commands:</b>
1️⃣ <b>Create Account</b>
2️⃣ <b>Delete Account</b>
3️⃣ <b>Associate Token</b>
4️⃣ <b>Send HBAR</b>
5️⃣ <b>Balance</b>
6️⃣ <b>History</b>
7️⃣ <b>Account Info</b>
8️⃣ <b>Help</b>

⚠️ Temporary accounts auto-delete after 30 minutes.`, {
            parse_mode: "HTML"
        });

        await bot.sendMessage(chatId, `Choose a command below 👇`, {
            reply_markup: {
                keyboard: [
                    ["📝 Create Account", "🗑️ Delete Account"],
                    ["🐝 Send HBAR", "🔗 Associate Token"],
                    ["💰 Balance", "📜 History"],
                    ["👤 Account Info", "ℹ️ Help"]
                ],
                resize_keyboard: true
            }
        });

        await bot.answerCallbackQuery(query.id);
    }
});

// Help command
bot.onText(/\/help|ℹ️ Help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpText = `
<b>ℹ️ About Hedera Wallet Bot</b>

<b>Features:</b>
• Create/delete temporary wallets
• Transfer HBAR, associate tokens
• View history and account info

<b>Links:</b>
<a href="https://hashscan.io">HashScan</a>
Bot Version: 1.0 | Network: Testnet`;

    await bot.sendMessage(chatId, helpText, { parse_mode: "HTML" });
    await bot.sendMessage(chatId, "🌐 https://hedera.com", { disable_web_page_preview: false });
});

// Wallet creation
bot.onText(/\/create_wallet|📝 Create Account/, async (msg) => {
    const chatId = msg.chat.id;
    if (userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ You already have a wallet. Use /delete_wallet first.");

    try {
        const newPrivateKey = PrivateKey.generateECDSA();
        const newPublicKey = newPrivateKey.publicKey;

        const createTx = await new AccountCreateTransaction().setKey(newPublicKey).setInitialBalance(new Hbar(0)).execute(client);
        const receipt = await createTx.getReceipt(client);
        const newAccountId = receipt.accountId;

        await new TransferTransaction().addHbarTransfer(operatorId, new Hbar(-5)).addHbarTransfer(newAccountId, new Hbar(5)).execute(client);

        const timer = setTimeout(() => deleteWallet(chatId, true), 30 * 60 * 1000);
        userWallets[chatId] = { accountId: newAccountId, privateKey: newPrivateKey, timer };

        bot.sendMessage(chatId, `✅ Wallet Created!\n🆔 ${newAccountId}\n🔐 ${newPrivateKey}\n⏳ Auto-deletes in 30 min.`);
    } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, "❌ Wallet creation failed.");
    }
});

// Wallet deletion
bot.onText(/\/delete_wallet|🗑️ Delete Account/, async (msg) => {
    const chatId = msg.chat.id;
    if (!userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ No active wallet.");
    await deleteWallet(chatId, false);
});

// Associate token
bot.onText(/\/associate_token (.+)|🔗 Associate Token/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tokenId = match?.[1];
    if (!userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ No active wallet.");
    if (!tokenId) return bot.sendMessage(chatId, "❗ Provide token ID: /associate_token 0.0.xxxx");

    try {
        const { accountId, privateKey } = userWallets[chatId];
        const tx = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([tokenId]).freezeWith(client).sign(privateKey);
        await tx.execute(client).then(t => t.getReceipt(client));
        bot.sendMessage(chatId, `✅ Associated token ${tokenId}`);
    } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, "❌ Token association failed.");
    }
});

// Send HBAR
bot.onText(/\/send_hbar (.+) (.+)|🐝 Send HBAR/, async (msg, match) => {
    const chatId = msg.chat.id;
    const [target, amt] = match?.input?.split(" ").slice(1);
    const amount = parseFloat(amt);

    if (!userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ No wallet found.");
    if (!target || isNaN(amount)) return bot.sendMessage(chatId, "❗ Usage: /send_hbar 0.0.xxxx 1.5");

    try {
        const { accountId, privateKey } = userWallets[chatId];
        const tx = await new TransferTransaction().addHbarTransfer(accountId, new Hbar(-amount)).addHbarTransfer(target, new Hbar(amount)).freezeWith(client).sign(privateKey);
        await tx.execute(client).then(t => t.getReceipt(client));
        bot.sendMessage(chatId, `✅ Sent ${amount} HBAR to ${target}`);
    } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, "❌ HBAR send failed.");
    }
});

// Balance check
bot.onText(/\/balance|💰 Balance/, async (msg) => {
    const chatId = msg.chat.id;
    if (!userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ No wallet found.");
    const balance = await new AccountBalanceQuery().setAccountId(userWallets[chatId].accountId).execute(client);
    bot.sendMessage(chatId, `💰 HBAR Balance: ${balance.hbars}`);
});

// History view
bot.onText(/\/history|📜 History/, async (msg) => {
    const chatId = msg.chat.id;
    if (!userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ No wallet found.");
    const { accountId } = userWallets[chatId];
    const res = await axios.get(`https://testnet.mirrornode.hedera.com/api/v1/transactions?account.id=${accountId}&limit=5&order=desc`);
    const txs = res.data.transactions;
    if (txs.length === 0) return bot.sendMessage(chatId, "📭 No transactions found.");
    let msgText = "📜 Last 5 Transactions:\n\n";
    txs.forEach(tx => {
        msgText += `🔹 Type: ${tx.transaction_type}\n🕓 Time: ${tx.consensus_timestamp}\nStatus: ${tx.result}\n\n`;
    });
    bot.sendMessage(chatId, msgText);
});

// Account Info
bot.onText(/\/account_info|👤 Account Info/, async (msg) => {
    const chatId = msg.chat.id;
    if (!userWallets[chatId]) return bot.sendMessage(chatId, "⚠️ No wallet found.");
    const { accountId } = userWallets[chatId];
    const info = await new AccountInfoQuery().setAccountId(accountId).execute(client);
    const msgText = `📘 Info for ${accountId}\n🔑 Key: ${info.key}\n💰 Balance: ${info.balance}`;
    bot.sendMessage(chatId, msgText);
});

// Wallet deletion logic
async function deleteWallet(chatId, isAuto) {
    const { accountId, privateKey, timer } = userWallets[chatId];
    clearTimeout(timer);
    try {
        const tx = await new AccountDeleteTransaction().setAccountId(accountId).setTransferAccountId(operatorId).freezeWith(client).sign(privateKey);
        await tx.execute(client).then(t => t.getReceipt(client));
        delete userWallets[chatId];
        bot.sendMessage(chatId, isAuto ? `⏳ Auto-deleted wallet ${accountId}` : `🗑️ Deleted wallet ${accountId}`);
    } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, "❌ Failed to delete wallet.");
    }
}