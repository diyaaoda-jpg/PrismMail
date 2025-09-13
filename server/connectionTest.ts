import { ImapFlow } from 'imapflow';
import { decryptAccountSettingsWithPassword } from './crypto';

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  lastChecked: Date;
}

/**
 * Test IMAP connection with the provided settings
 * @param settingsJson - Settings JSON (plain text for testing, encrypted for saved accounts)
 * @returns Connection test result
 */
export async function testImapConnection(settingsJson: string): Promise<ConnectionTestResult> {
  try {
    // For connection testing, the settingsJson is plain text
    // For saved accounts, it's encrypted and needs decryption
    let settings: any;
    try {
      // First try to parse as plain JSON (for connection testing)
      settings = JSON.parse(settingsJson);
    } catch {
      // If that fails, try to decrypt (for saved accounts)
      settings = decryptAccountSettingsWithPassword(settingsJson);
    }
    
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.useSSL,
      auth: {
        user: settings.username,
        pass: settings.password,
      },
      // Connection timeout
      socketTimeout: 10000,
      greetingTimeout: 10000,
    });

    // Attempt to connect
    await client.connect();
    
    // List mailboxes to verify connection works
    await client.list();
    
    // Close connection
    await client.logout();

    return {
      success: true,
      lastChecked: new Date(),
    };
  } catch (error: any) {
    console.error('IMAP connection test failed:', error);
    
    // Extract meaningful error message
    let errorMessage = 'Connection failed';
    if (error.message) {
      if (error.message.includes('ENOTFOUND')) {
        errorMessage = 'Server not found - check host address';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused - check port and SSL settings';
      } else if (error.message.includes('Invalid credentials')) {
        errorMessage = 'Invalid username or password';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timeout - server may be unreachable';
      } else {
        errorMessage = error.message.substring(0, 200); // Truncate long error messages
      }
    }

    return {
      success: false,
      error: errorMessage,
      lastChecked: new Date(),
    };
  }
}

/**
 * Test EWS (Exchange Web Services) connection
 * @param settingsJson - Settings JSON (plain text for testing, encrypted for saved accounts)
 * @returns Connection test result
 */
export async function testEwsConnection(settingsJson: string): Promise<ConnectionTestResult> {
  try {
    // For connection testing, the settingsJson is plain text
    // For saved accounts, it's encrypted and needs decryption
    let settings: any;
    try {
      // First try to parse as plain JSON (for connection testing)
      settings = JSON.parse(settingsJson);
    } catch {
      // If that fails, try to decrypt (for saved accounts)
      settings = decryptAccountSettingsWithPassword(settingsJson);
    }
    
    // Dynamic import to avoid require() issues
    const ewsApi = await import('ews-javascript-api');
    const { ExchangeService, ExchangeVersion, WebCredentials, Uri, WellKnownFolderName } = ewsApi;
    
    const service = new ExchangeService(ExchangeVersion.Exchange2013);
    service.Credentials = new WebCredentials(settings.username, settings.password);
    
    // Construct EWS URL - typically https://server/EWS/Exchange.asmx
    let ewsUrl = settings.host;
    if (!ewsUrl.startsWith('http')) {
      ewsUrl = (settings.useSSL ? 'https://' : 'http://') + ewsUrl;
    }
    if (!ewsUrl.includes('/EWS/') && !ewsUrl.includes('/ews')) {
      ewsUrl = ewsUrl.endsWith('/') ? ewsUrl + 'EWS/Exchange.asmx' : ewsUrl + '/EWS/Exchange.asmx';
    }
    
    service.Url = new Uri(ewsUrl);
    
    // Try to get inbox folder to test connection
    await service.GetFolder(WellKnownFolderName.Inbox);

    return {
      success: true,
      lastChecked: new Date(),
    };
  } catch (error: any) {
    console.error('EWS connection test failed:', error);
    
    let errorMessage = 'EWS connection failed';
    if (error.message) {
      if (error.message.includes('401')) {
        errorMessage = 'Authentication failed - check username and password';
      } else if (error.message.includes('404')) {
        errorMessage = 'EWS endpoint not found - check server URL';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Connection timeout - server may be unreachable';
      } else {
        errorMessage = error.message.substring(0, 200);
      }
    }

    return {
      success: false,
      error: errorMessage,
      lastChecked: new Date(),
    };
  }
}

/**
 * Test connection based on protocol type
 * @param protocol - Either 'IMAP' or 'EWS'
 * @param settingsJson - Encrypted settings JSON from database
 * @returns Connection test result
 */
export async function testConnection(
  protocol: 'IMAP' | 'EWS',
  settingsJson: string
): Promise<ConnectionTestResult> {
  if (protocol === 'IMAP') {
    return await testImapConnection(settingsJson);
  } else if (protocol === 'EWS') {
    return await testEwsConnection(settingsJson);
  } else {
    return {
      success: false,
      error: `Unsupported protocol: ${protocol}`,
      lastChecked: new Date(),
    };
  }
}