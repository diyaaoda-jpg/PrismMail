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
// Normalize EWS URL to canonical Exchange endpoint format
function normalizeEwsUrl(hostUrl: string): string {
  let url: URL;
  try {
    // If no scheme, prepend https://
    if (!hostUrl.startsWith('http')) {
      hostUrl = 'https://' + hostUrl;
    }
    url = new URL(hostUrl);
  } catch {
    throw new Error('Invalid EWS server name format');
  }
  
  // Always use the canonical Exchange EWS endpoint (force HTTPS)
  return url.origin + '/EWS/Exchange.asmx';
}

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

    const ewsUrl = normalizeEwsUrl(settings.host);
    
    // Preflight check: Test EWS endpoint and check auth methods
    try {
      const preflightResponse = await fetch(ewsUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'PrismMail/1.0'
        },
        signal: AbortSignal.timeout(10000)
      });
      
      // Check if this looks like an EWS endpoint
      const contentType = preflightResponse.headers.get('content-type') || '';
      const wwwAuth = preflightResponse.headers.get('www-authenticate') || '';
      
      // If we get HTML instead of XML/SOAP, this isn't the right endpoint
      if (contentType.includes('text/html') && !contentType.includes('xml')) {
        throw new Error('EWS endpoint not found - server returned HTML instead of SOAP XML');
      }
      
      // Check authentication methods
      if (preflightResponse.status === 401) {
        if (!wwwAuth.toLowerCase().includes('basic')) {
          if (wwwAuth.toLowerCase().includes('ntlm') || wwwAuth.toLowerCase().includes('negotiate')) {
            throw new Error('Server requires NTLM/Kerberos authentication - Basic authentication not supported');
          }
          throw new Error('Server authentication method not supported');
        }
      }
      
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        throw new Error('EWS endpoint timeout - server may be unreachable');
      }
      if (fetchError.message.includes('EWS endpoint') || fetchError.message.includes('authentication')) {
        throw fetchError; // Re-throw our custom errors
      }
      throw new Error(`Cannot reach EWS endpoint: ${fetchError.message}`);
    }
    
    // Dynamic import to avoid require() issues
    const ewsApi = await import('ews-javascript-api');
    const { ExchangeService, ExchangeVersion, WebCredentials, Uri, WellKnownFolderName, Folder, PropertySet, BasePropertySet } = ewsApi;
    
    const service = new ExchangeService(ExchangeVersion.Exchange2013);
    service.Credentials = new WebCredentials(settings.username, settings.password);
    service.Url = new Uri(ewsUrl);
    
    // Enable pre-authentication for better compatibility
    service.PreAuthenticate = true;
    service.UserAgent = 'PrismMail/1.0';
    
    // Try to get inbox folder to test connection using correct API method
    const propertySet = new PropertySet(BasePropertySet.IdOnly);
    await Folder.Bind(service, WellKnownFolderName.Inbox, propertySet);

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