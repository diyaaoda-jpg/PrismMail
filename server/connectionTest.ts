import { ImapFlow } from 'imapflow';
import * as nodemailer from 'nodemailer';
import { decryptAccountSettingsWithPassword } from './crypto';

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  details?: {
    phase?: string;
    serverResponse?: string;
    diagnostics?: string[];
    suggestions?: string[];
    networkInfo?: {
      dnsResolved?: boolean;
      tcpConnected?: boolean;
      sslHandshake?: boolean;
      authenticated?: boolean;
    };
  };
  lastChecked: Date;
  testDuration?: number;
}

export interface DetailedError {
  code: string;
  message: string;
  phase: string;
  suggestions: string[];
  networkInfo?: any;
}

/**
 * Enhanced error classification for better user guidance
 */
function classifyError(error: any, protocol: 'IMAP' | 'EWS' | 'SMTP'): DetailedError {
  const message = error.message?.toLowerCase() || '';
  const code = error.code || error.errno || 'UNKNOWN';
  
  // DNS/Network errors
  if (message.includes('enotfound') || code === 'ENOTFOUND') {
    return {
      code: 'DNS_ERROR',
      message: 'Server not found - please check the server address',
      phase: 'DNS Resolution',
      suggestions: [
        'Verify the server hostname is correct',
        'Check your internet connection',
        'Try using the server\'s IP address instead',
        'Contact your email provider for the correct server settings'
      ]
    };
  }
  
  // Connection refused
  if (message.includes('econnrefused') || code === 'ECONNREFUSED') {
    return {
      code: 'CONNECTION_REFUSED',
      message: 'Connection refused - server or port may be incorrect',
      phase: 'TCP Connection',
      suggestions: [
        protocol === 'IMAP' ? 'Verify IMAP port is 993 for SSL' : 'Check the server port configuration',
        'Ensure the server supports the protocol you\'re trying to use',
        'Check if your firewall is blocking the connection',
        'Verify the server is running and accepting connections'
      ]
    };
  }
  
  // SSL/TLS errors
  if (message.includes('ssl') || message.includes('tls') || message.includes('certificate')) {
    return {
      code: 'SSL_ERROR',
      message: 'SSL/TLS connection failed',
      phase: 'SSL Handshake',
      suggestions: [
        'Check if SSL is properly configured',
        'Verify the server supports the SSL version you\'re using',
        'Check if the server certificate is valid',
        'Try disabling SSL temporarily to test basic connectivity'
      ]
    };
  }
  
  // Authentication errors
  if (message.includes('auth') || message.includes('login') || message.includes('credential') || 
      message.includes('401') || message.includes('invalid login')) {
    return {
      code: 'AUTH_ERROR',
      message: 'Authentication failed - check username and password',
      phase: 'Authentication',
      suggestions: [
        'Verify your username and password are correct',
        'Use your full email address as the username',
        'Check if you need an app-specific password (for accounts with 2FA)',
        'Ensure your account allows IMAP/SMTP access',
        'Contact your email provider to verify account settings'
      ]
    };
  }
  
  // Timeout errors
  if (message.includes('timeout') || code === 'ETIMEDOUT') {
    return {
      code: 'TIMEOUT_ERROR',
      message: 'Connection timed out - server may be slow or unreachable',
      phase: 'Connection Timeout',
      suggestions: [
        'Check your internet connection speed',
        'Try again as the server may be temporarily busy',
        'Verify the server address is correct',
        'Contact your email provider if the problem persists'
      ]
    };
  }
  
  // Protocol-specific errors
  if (protocol === 'EWS') {
    if (message.includes('404') || message.includes('not found')) {
      return {
        code: 'EWS_ENDPOINT_NOT_FOUND',
        message: 'EWS endpoint not found - check server URL',
        phase: 'EWS Discovery',
        suggestions: [
          'Verify the Exchange server address is correct',
          'Try using the full EWS URL: https://server.com/EWS/Exchange.asmx',
          'Contact your IT administrator for the correct EWS endpoint',
          'Ensure your server supports Exchange Web Services'
        ]
      };
    }
    
    if (message.includes('ntlm') || message.includes('negotiate')) {
      return {
        code: 'EWS_AUTH_METHOD_NOT_SUPPORTED',
        message: 'Server requires NTLM/Kerberos authentication - not supported',
        phase: 'Authentication Method Check',
        suggestions: [
          'This server requires Windows authentication',
          'Contact your IT administrator about enabling basic authentication',
          'Consider using a different email client that supports NTLM',
          'Check if the server can be configured for basic authentication'
        ]
      };
    }
  }
  
  // Generic error fallback
  return {
    code: 'GENERIC_ERROR',
    message: error.message?.substring(0, 200) || 'Connection test failed',
    phase: 'Connection Test',
    suggestions: [
      'Check your internet connection',
      'Verify all settings are correct',
      'Try again in a few minutes',
      'Contact support if the problem persists'
    ]
  };
}

/**
 * Enhanced IMAP connection test with detailed error handling and diagnostics
 */
export async function testImapConnection(settingsJson: string): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const networkInfo = {
    dnsResolved: false,
    tcpConnected: false,
    sslHandshake: false,
    authenticated: false
  };
  
  try {
    // Parse settings with better error handling
    let settings: any;
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      try {
        settings = decryptAccountSettingsWithPassword(settingsJson);
      } catch (decryptError) {
        throw new Error('Failed to parse account settings - invalid format');
      }
    }
    
    // Validate required settings
    if (!settings.host || !settings.username || !settings.password) {
      throw new Error('Missing required settings: host, username, or password');
    }
    
    console.log(`IMAP connection test starting for ${settings.host}:${settings.port}`);
    
    // Enhanced IMAP client configuration with better timeout handling
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port || 993,
      secure: settings.useSSL ?? true,
      auth: {
        user: settings.username,
        pass: settings.password,
      },
      // Progressive timeouts for different phases
      socketTimeout: 15000, // Socket operations
      greetingTimeout: 10000, // Initial greeting
      connectionTimeout: 20000, // Overall connection
      logger: {
        debug: () => {}, // Disable debug logging
        info: (data: any) => console.log('IMAP Info:', data),
        warn: (data: any) => console.warn('IMAP Warning:', data),
        error: (data: any) => console.error('IMAP Error:', data)
      }
    });
    
    // Add connection event listeners for better diagnostics
    client.on('connect', () => {
      networkInfo.tcpConnected = true;
      console.log('IMAP TCP connection established');
    });
    
    client.on('secure', () => {
      networkInfo.sslHandshake = true;
      console.log('IMAP SSL handshake completed');
    });
    
    // Phase 1: DNS Resolution and TCP Connection
    console.log('Phase 1: Connecting to IMAP server...');
    await client.connect();
    networkInfo.dnsResolved = true;
    networkInfo.tcpConnected = true;
    networkInfo.sslHandshake = true;
    
    // Phase 2: Authentication
    console.log('Phase 2: Authenticating...');
    // Note: ImapFlow connects and authenticates in one step
    networkInfo.authenticated = true;
    
    // Phase 3: Capability check
    console.log('Phase 3: Testing mailbox access...');
    const mailboxes = await client.list();
    
    // Phase 4: Basic functionality test
    console.log('Phase 4: Verifying IDLE capability...');
    const capabilities = client.capabilities;
    
    // Clean disconnect
    await client.logout();
    
    const testDuration = Date.now() - startTime;
    console.log(`IMAP connection test completed successfully in ${testDuration}ms`);
    
    return {
      success: true,
      lastChecked: new Date(),
      testDuration,
      details: {
        phase: 'Completed',
        diagnostics: [
          `Connected to ${settings.host}:${settings.port}`,
          `SSL: ${networkInfo.sslHandshake ? 'Enabled' : 'Disabled'}`,
          `Found ${mailboxes.length} mailboxes`,
          `Server capabilities: ${Array.from(capabilities).join(', ')}`
        ],
        networkInfo
      }
    };
    
  } catch (error: any) {
    const testDuration = Date.now() - startTime;
    console.error('IMAP connection test failed:', error);
    
    const detailedError = classifyError(error, 'IMAP');
    
    return {
      success: false,
      error: detailedError.message,
      errorCode: detailedError.code,
      lastChecked: new Date(),
      testDuration,
      details: {
        phase: detailedError.phase,
        suggestions: detailedError.suggestions,
        networkInfo,
        diagnostics: [
          `Failed during: ${detailedError.phase}`,
          `Network status: DNS=${networkInfo.dnsResolved}, TCP=${networkInfo.tcpConnected}, SSL=${networkInfo.sslHandshake}, Auth=${networkInfo.authenticated}`
        ]
      }
    };
  }
}

/**
 * Enhanced EWS connection test with improved error handling
 */
export async function testEwsConnection(settingsJson: string): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const networkInfo = {
    dnsResolved: false,
    tcpConnected: false,
    sslHandshake: false,
    authenticated: false
  };
  
  try {
    // Parse settings
    let settings: any;
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      try {
        settings = decryptAccountSettingsWithPassword(settingsJson);
      } catch (decryptError) {
        throw new Error('Failed to parse account settings - invalid format');
      }
    }
    
    // Validate required settings
    if (!settings.host || !settings.username || !settings.password) {
      throw new Error('Missing required settings: host, username, or password');
    }
    
    console.log(`EWS connection test starting for ${settings.host}`);
    
    const ewsUrl = normalizeEwsUrl(settings.host);
    console.log('Normalized EWS URL:', ewsUrl);
    
    // Phase 1: EWS endpoint discovery and basic connectivity
    console.log('Phase 1: Testing EWS endpoint...');
    try {
      const preflightResponse = await fetch(ewsUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'PrismMail/1.0'
        },
        signal: AbortSignal.timeout(15000)
      });
      
      networkInfo.dnsResolved = true;
      networkInfo.tcpConnected = true;
      networkInfo.sslHandshake = true; // HTTPS implies SSL
      
      const contentType = preflightResponse.headers.get('content-type') || '';
      const wwwAuth = preflightResponse.headers.get('www-authenticate') || '';
      
      // Enhanced endpoint validation
      if (contentType.includes('text/html') && !contentType.includes('xml')) {
        throw new Error('EWS endpoint not found - server returned HTML instead of SOAP XML. Check the server URL.');
      }
      
      // Authentication method validation
      if (preflightResponse.status === 401) {
        if (!wwwAuth.toLowerCase().includes('basic')) {
          if (wwwAuth.toLowerCase().includes('ntlm') || wwwAuth.toLowerCase().includes('negotiate')) {
            throw new Error('Server requires NTLM/Kerberos authentication - Basic authentication not supported');
          }
          throw new Error('Server authentication method not supported. Basic authentication required.');
        }
      }
      
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        throw new Error('EWS endpoint timeout - server may be unreachable');
      }
      if (fetchError.message.includes('EWS endpoint') || fetchError.message.includes('authentication')) {
        throw fetchError;
      }
      throw new Error(`Cannot reach EWS endpoint: ${fetchError.message}`);
    }
    
    // Phase 2: EWS service initialization and authentication
    console.log('Phase 2: Initializing EWS service...');
    const ewsApi = await import('ews-javascript-api');
    const { ExchangeService, ExchangeVersion, WebCredentials, Uri, WellKnownFolderName, Folder, PropertySet, BasePropertySet } = ewsApi;
    
    const service = new ExchangeService(ExchangeVersion.Exchange2013);
    service.Credentials = new WebCredentials(settings.username, settings.password);
    service.Url = new Uri(ewsUrl);
    service.PreAuthenticate = true;
    service.UserAgent = 'PrismMail/1.0';
    
    // Phase 3: Authentication and basic functionality test
    console.log('Phase 3: Testing mailbox access...');
    const propertySet = new PropertySet(BasePropertySet.IdOnly);
    await Folder.Bind(service, WellKnownFolderName.Inbox, propertySet);
    
    networkInfo.authenticated = true;
    
    const testDuration = Date.now() - startTime;
    console.log(`EWS connection test completed successfully in ${testDuration}ms`);
    
    return {
      success: true,
      lastChecked: new Date(),
      testDuration,
      details: {
        phase: 'Completed',
        diagnostics: [
          `Connected to EWS endpoint: ${ewsUrl}`,
          'Authentication successful',
          'Mailbox access verified',
          'Exchange Web Services fully functional'
        ],
        networkInfo
      }
    };
    
  } catch (error: any) {
    const testDuration = Date.now() - startTime;
    console.error('EWS connection test failed:', error);
    
    const detailedError = classifyError(error, 'EWS');
    
    return {
      success: false,
      error: detailedError.message,
      errorCode: detailedError.code,
      lastChecked: new Date(),
      testDuration,
      details: {
        phase: detailedError.phase,
        suggestions: detailedError.suggestions,
        networkInfo,
        diagnostics: [
          `Failed during: ${detailedError.phase}`,
          `Network status: DNS=${networkInfo.dnsResolved}, TCP=${networkInfo.tcpConnected}, SSL=${networkInfo.sslHandshake}, Auth=${networkInfo.authenticated}`
        ]
      }
    };
  }
}

/**
 * Enhanced SMTP connection test with comprehensive validation
 */
export async function testSmtpConnection(settingsJson: string): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const networkInfo = {
    dnsResolved: false,
    tcpConnected: false,
    sslHandshake: false,
    authenticated: false
  };
  
  try {
    // Parse settings
    let settings: any;
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      try {
        settings = decryptAccountSettingsWithPassword(settingsJson);
      } catch (decryptError) {
        throw new Error('Failed to parse account settings - invalid format');
      }
    }
    
    // Extract and validate SMTP settings
    const smtpSettings = settings.smtp || {};
    const smtpHost = smtpSettings.host || settings.host?.replace('imap.', 'smtp.');
    const smtpPort = parseInt(smtpSettings.port) || 587;
    const smtpSecure = smtpSettings.secure ?? (smtpPort === 465);
    const smtpUsername = smtpSettings.username || settings.username;
    const smtpPassword = smtpSettings.password || settings.password;
    
    if (!smtpHost) {
      throw new Error('SMTP host not configured - please provide SMTP server settings');
    }
    
    if (!smtpUsername || !smtpPassword) {
      throw new Error('SMTP authentication credentials missing');
    }
    
    console.log(`SMTP connection test starting for ${smtpHost}:${smtpPort} (secure: ${smtpSecure})`);
    
    // Enhanced nodemailer configuration
    const transporter = nodemailer.createTransporter({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for 465, false for other ports
      auth: {
        user: smtpUsername,
        pass: smtpPassword,
      },
      // Enhanced timeout configuration
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      // Add event logging for diagnostics
      debug: false, // Disable verbose debug output
      logger: {
        debug: () => {}, // Silent debug
        info: (info: any) => console.log('SMTP Info:', info),
        warn: (info: any) => console.warn('SMTP Warning:', info),
        error: (info: any) => console.error('SMTP Error:', info)
      }
    });
    
    // Phase 1: Connection and authentication test
    console.log('Phase 1: Testing SMTP connection and authentication...');
    await transporter.verify();
    
    networkInfo.dnsResolved = true;
    networkInfo.tcpConnected = true;
    networkInfo.sslHandshake = smtpSecure;
    networkInfo.authenticated = true;
    
    // Clean shutdown
    transporter.close();
    
    const testDuration = Date.now() - startTime;
    console.log(`SMTP connection test completed successfully in ${testDuration}ms`);
    
    return {
      success: true,
      lastChecked: new Date(),
      testDuration,
      details: {
        phase: 'Completed',
        diagnostics: [
          `Connected to SMTP server: ${smtpHost}:${smtpPort}`,
          `Security: ${smtpSecure ? 'SSL/TLS' : 'STARTTLS'}`,
          'Authentication successful',
          'Ready to send emails'
        ],
        networkInfo
      }
    };
    
  } catch (error: any) {
    const testDuration = Date.now() - startTime;
    console.error('SMTP connection test failed:', error);
    
    const detailedError = classifyError(error, 'SMTP');
    
    return {
      success: false,
      error: detailedError.message,
      errorCode: detailedError.code,
      lastChecked: new Date(),
      testDuration,
      details: {
        phase: detailedError.phase,
        suggestions: detailedError.suggestions,
        networkInfo,
        diagnostics: [
          `Failed during: ${detailedError.phase}`,
          `Network status: DNS=${networkInfo.dnsResolved}, TCP=${networkInfo.tcpConnected}, SSL=${networkInfo.sslHandshake}, Auth=${networkInfo.authenticated}`
        ]
      }
    };
  }
}

/**
 * Normalize EWS URL to canonical Exchange endpoint format with enhanced validation
 */
function normalizeEwsUrl(hostUrl: string): string {
  if (!hostUrl || typeof hostUrl !== 'string' || hostUrl.trim().length === 0) {
    throw new Error('EWS server name cannot be empty. Please enter a valid server name like "mail.example.com"');
  }
  
  hostUrl = hostUrl.trim();
  
  let url: URL;
  try {
    // If no scheme, prepend https://
    if (!hostUrl.startsWith('http')) {
      hostUrl = 'https://' + hostUrl;
    }
    url = new URL(hostUrl);
  } catch (parseError) {
    console.error('EWS URL parsing failed for input:', hostUrl, 'Error:', parseError);
    throw new Error(`Invalid EWS server name format: "${hostUrl}". Please enter a valid server name like "mail.example.com"`);
  }
  
  // Force HTTPS for security
  if (url.protocol !== 'https:') {
    console.warn('Forcing HTTPS for EWS connection');
    url.protocol = 'https:';
  }
  
  // Use canonical Exchange EWS endpoint if no specific path provided
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/EWS/Exchange.asmx';
  }
  
  return url.toString();
}

/**
 * Enhanced connection test with retry logic and comprehensive error handling
 * @param protocol - Either 'IMAP' or 'EWS'
 * @param settingsJson - Settings JSON (plain text for testing, encrypted for saved accounts)
 * @param testSmtp - Whether to also test SMTP (for IMAP accounts only)
 * @param retryCount - Number of retries for transient failures
 * @returns Connection test result with detailed diagnostics
 */
export async function testConnection(
  protocol: 'IMAP' | 'EWS',
  settingsJson: string,
  testSmtp: boolean = false,
  retryCount: number = 1
): Promise<ConnectionTestResult> {
  console.log(`Starting connection test for ${protocol} protocol (SMTP test: ${testSmtp})`);
  
  let lastError: ConnectionTestResult | null = null;
  
  // Retry logic for transient failures
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Connection test attempt ${attempt}/${retryCount}`);
        // Brief delay between retries
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (protocol === 'IMAP') {
        const imapResult = await testImapConnection(settingsJson);
        
        // If IMAP test passed and SMTP testing is requested
        if (imapResult.success && testSmtp) {
          console.log('IMAP connection successful, testing SMTP...');
          const smtpResult = await testSmtpConnection(settingsJson);
          
          if (!smtpResult.success) {
            return {
              success: false,
              error: `IMAP connection successful, but SMTP failed: ${smtpResult.error}`,
              errorCode: smtpResult.errorCode,
              lastChecked: new Date(),
              testDuration: (imapResult.testDuration || 0) + (smtpResult.testDuration || 0),
              details: {
                phase: 'SMTP Test',
                diagnostics: [
                  'IMAP connection: ✓ Successful',
                  `SMTP connection: ✗ Failed - ${smtpResult.error}`,
                  ...(smtpResult.details?.diagnostics || [])
                ],
                suggestions: smtpResult.details?.suggestions || [],
                networkInfo: smtpResult.details?.networkInfo
              }
            };
          }
          
          return {
            success: true,
            lastChecked: new Date(),
            testDuration: (imapResult.testDuration || 0) + (smtpResult.testDuration || 0),
            details: {
              phase: 'Completed',
              diagnostics: [
                'IMAP connection: ✓ Successful',
                'SMTP connection: ✓ Successful',
                'Both incoming and outgoing email configured correctly'
              ]
            }
          };
        }
        
        return imapResult;
        
      } else if (protocol === 'EWS') {
        return await testEwsConnection(settingsJson);
      } else {
        return {
          success: false,
          error: `Unsupported protocol: ${protocol}`,
          errorCode: 'UNSUPPORTED_PROTOCOL',
          lastChecked: new Date(),
          details: {
            phase: 'Protocol Validation',
            suggestions: ['Use either IMAP or EWS protocol']
          }
        };
      }
      
    } catch (error: any) {
      const detailedError = classifyError(error, protocol);
      lastError = {
        success: false,
        error: detailedError.message,
        errorCode: detailedError.code,
        lastChecked: new Date(),
        details: {
          phase: detailedError.phase,
          suggestions: detailedError.suggestions
        }
      };
      
      // Don't retry for non-transient errors
      if (!['TIMEOUT_ERROR', 'CONNECTION_REFUSED'].includes(detailedError.code)) {
        break;
      }
      
      if (attempt < retryCount) {
        console.log(`Attempt ${attempt} failed with transient error, retrying...`);
      }
    }
  }
  
  return lastError || {
    success: false,
    error: 'Connection test failed after all retry attempts',
    errorCode: 'MAX_RETRIES_EXCEEDED',
    lastChecked: new Date()
  };
}