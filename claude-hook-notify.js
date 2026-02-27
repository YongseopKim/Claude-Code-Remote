#!/usr/bin/env node

/**
 * Claude Hook Notification Script
 * Called by Claude Code hooks to send Telegram notifications
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables from the project directory
const projectDir = path.dirname(__filename);
const envPath = path.join(projectDir, '.env');

console.log('🔍 Hook script started from:', process.cwd());
console.log('📁 Script location:', __filename);
console.log('🔧 Looking for .env at:', envPath);

if (fs.existsSync(envPath)) {
    console.log('✅ .env file found, loading...');
    dotenv.config({ path: envPath });
} else {
    console.error('❌ .env file not found at:', envPath);
    console.log('📂 Available files in script directory:');
    try {
        const files = fs.readdirSync(projectDir);
        console.log(files.join(', '));
    } catch (error) {
        console.error('Cannot read directory:', error.message);
    }
    process.exit(1);
}

const TelegramChannel = require('./src/channels/telegram/telegram');
const DesktopChannel = require('./src/channels/local/desktop');
const EmailChannel = require('./src/channels/email/smtp');

async function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({}); }
        });
        setTimeout(() => resolve({}), 2000);
    });
}

async function sendHookNotification() {
    try {
        console.log('🔔 Claude Hook: Sending notifications...');

        // Get notification type from command line argument
        const notificationType = process.argv[2] || 'completed';

        // Read hook data from stdin (Claude Code passes JSON)
        const hookData = await readStdin();

        const channels = [];
        const results = [];
        
        // Configure Desktop channel (always enabled for sound)
        const desktopChannel = new DesktopChannel({
            completedSound: 'Glass',
            waitingSound: 'Tink'
        });
        channels.push({ name: 'Desktop', channel: desktopChannel });
        
        // Configure Telegram channel if enabled
        if (process.env.TELEGRAM_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
            const telegramConfig = {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                chatId: process.env.TELEGRAM_CHAT_ID,
                groupId: process.env.TELEGRAM_GROUP_ID,
                forceIPv4: process.env.TELEGRAM_FORCE_IPV4 === 'true'
            };
            
            if (telegramConfig.botToken && (telegramConfig.chatId || telegramConfig.groupId)) {
                const telegramChannel = new TelegramChannel(telegramConfig);
                channels.push({ name: 'Telegram', channel: telegramChannel });
            }
        }
        
        // Configure Email channel if enabled
        if (process.env.EMAIL_ENABLED === 'true' && process.env.SMTP_USER) {
            const emailConfig = {
                smtp: {
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT),
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS
                    }
                },
                from: process.env.EMAIL_FROM,
                fromName: process.env.EMAIL_FROM_NAME,
                to: process.env.EMAIL_TO
            };
            
            if (emailConfig.smtp.host && emailConfig.smtp.auth.user && emailConfig.to) {
                const emailChannel = new EmailChannel(emailConfig);
                channels.push({ name: 'Email', channel: emailChannel });
            }
        }
        
        // Get current working directory and tmux session
        const currentDir = process.cwd();
        const projectName = path.basename(currentDir);
        
        // Try to get current tmux target (session:window.pane)
        const { getCurrentTmuxTarget } = require('./src/utils/tmux-utils');
        let tmuxSession = getCurrentTmuxTarget() || process.env.TMUX_SESSION || 'claude-real';
        
        // Create notification based on type
        const titleMap = {
            completed: 'Task Completed',
            waiting: 'Waiting for Input',
            permission: 'Permission Required'
        };
        const notification = {
            type: notificationType,
            title: `Claude ${titleMap[notificationType] || notificationType}`,
            message: hookData.message || `Claude ${titleMap[notificationType] || 'notification'}`,
            project: projectName,
            tmuxSession: tmuxSession
        };
        // For permission type, build a detailed permission description
        if (notificationType === 'permission') {
            let permissionMessage = hookData.message || 'Permission required';

            // If hook provides tool_name and tool_input (from PermissionRequest hook),
            // build a detailed description including the actual command/arguments
            if (hookData.tool_name) {
                const toolName = hookData.tool_name;
                const toolInput = hookData.tool_input || {};
                let detail = '';

                if (toolName === 'Bash' && toolInput.command) {
                    detail = toolInput.command;
                } else if (toolName === 'Edit' && toolInput.file_path) {
                    detail = `File: ${toolInput.file_path}`;
                } else if (toolName === 'Write' && toolInput.file_path) {
                    detail = `File: ${toolInput.file_path}`;
                } else if (toolName === 'Read' && toolInput.file_path) {
                    detail = `File: ${toolInput.file_path}`;
                } else if (toolInput.command || toolInput.file_path || toolInput.url) {
                    detail = toolInput.command || toolInput.file_path || toolInput.url;
                } else {
                    // Fallback: show first meaningful value from tool_input
                    const vals = Object.values(toolInput).filter(v => typeof v === 'string' && v.length > 0);
                    if (vals.length > 0) detail = vals[0];
                }

                permissionMessage = `Permission to use ${toolName}`;
                if (detail) {
                    // Truncate long commands for readability
                    if (detail.length > 300) detail = detail.substring(0, 297) + '...';
                    permissionMessage += `\n\n${detail}`;
                }
            }

            // Build approval options from permission_suggestions
            const approvalOptions = ['Yes'];
            if (hookData.permission_suggestions && Array.isArray(hookData.permission_suggestions)) {
                for (const suggestion of hookData.permission_suggestions) {
                    if (suggestion.type === 'addRules' && Array.isArray(suggestion.rules)) {
                        for (const rule of suggestion.rules) {
                            const toolName = rule.toolName || '';
                            const ruleContent = rule.ruleContent || '';
                            if (toolName && ruleContent) {
                                approvalOptions.push(`Yes, and don't ask again for: ${toolName}(${ruleContent}:*)`);
                            }
                        }
                    }
                }
            }
            approvalOptions.push('No');

            notification.metadata = {
                permissionMessage: permissionMessage,
                approvalOptions: approvalOptions,
                tmuxSession: tmuxSession
            };
        }
        // For completed/waiting, don't set metadata - let TelegramChannel extract from tmux
        
        console.log(`📱 Sending ${notificationType} notification for project: ${projectName}`);
        console.log(`🖥️ Tmux target: ${tmuxSession}`);
        
        // Send notifications to all configured channels
        for (const { name, channel } of channels) {
            try {
                console.log(`📤 Sending to ${name}...`);
                const result = await channel.send(notification);
                results.push({ name, success: result });
                
                if (result) {
                    console.log(`✅ ${name} notification sent successfully!`);
                } else {
                    console.log(`❌ Failed to send ${name} notification`);
                }
            } catch (error) {
                console.error(`❌ ${name} notification error:`, error.message);
                results.push({ name, success: false, error: error.message });
            }
        }
        
        // Report overall results
        const successful = results.filter(r => r.success).length;
        const total = results.length;
        
        if (successful > 0) {
            console.log(`\n✅ Successfully sent notifications via ${successful}/${total} channels`);
            if (results.some(r => r.name === 'Telegram' && r.success)) {
                console.log('📋 You can now send new commands via Telegram');
            }
        } else {
            console.log('\n❌ All notification channels failed');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Hook notification error:', error.message);
        process.exit(1);
    }
}

// Show usage if no arguments
if (process.argv.length < 2) {
    console.log('Usage: node claude-hook-notify.js [completed|waiting|permission]');
    process.exit(1);
}

sendHookNotification();