const workspace = require('genesys-workspace-client-js');
const auth = require('genesys-authorization-client-js');
const url = require('url');
const cometDLib = require('cometd');
require('cometd-nodejs-client').adapt();

//Usage: <apiKey> <clientId> <clientSecret> <apiUrl> <agentUsername> <agentPassword>
const argv = process.argv.slice(2);
const apiKey = argv[0];
const clientId = argv[1];
const clientSecret = argv[2];
const apiUrl = argv[3];
const username = argv[4];
const password = argv[5];

const workspaceUrl = `${apiUrl}/workspace/v3`;
const authUrl = `${apiUrl}`;

function main() {
	//region Initialize API Client
	//Create and setup ApiClient instance with your ApiKey and Workspace API URL.
	const workspaceClient = new workspace.ApiClient();
	workspaceClient.basePath = workspaceUrl;
	workspaceClient.defaultHeaders = { 'x-api-key': apiKey };

	const authClient = new auth.ApiClient();
	authClient.basePath = authUrl;
	authClient.defaultHeaders = { 'x-api-key': apiKey };

	//region Create SessionApi and VoiceApi instances
	//Creating instances of SessionApi and VoiceApi using the ApiClient.
	const sessionApi = new workspace.SessionApi(workspaceClient);
	const voiceApi = new workspace.VoiceApi(workspaceClient);

	//region Create AuthenticationApi instance
	//Create instance of AuthenticationApi using the authorization ApiClient which will be used to retrieve access token.
	const authApi = new auth.AuthenticationApi(authClient); 


	//region Oauth2 Authentication
	//Performing Oauth 2.0 authentication.
	console.log("Retrieving access token...");

	const authorization = "Basic " + new String(new Buffer(clientId + ":" + clientSecret).toString("base64"));
	authApi.retrieveToken("password", "openid", {
		clientId: clientId,
		username: username,
		password: password,
		authorization: authorization
	}).then((resp) => {
		
		if(!resp["access_token"]) {
			console.error("No access token");
		
		} else {
		
			console.log("Retrieved access token");
			console.log("Initializing workspace...");
	
			sessionApi.initializeWorkspaceWithHttpInfo({"authorization": "Bearer " + resp["access_token"]}).then((resp) => {
				//region Getting Session ID
				//If the initialize-workspace call is successful, the it will return the workspace session ID as a cookie.
				//We still must wait for 'InitializeWorkspaceComplete' cometD event in order to get user data for the user we are loggin in.
				if(resp.data.status.code == 1) {
					const sessionCookie = resp.response.header["set-cookie"].find(v => v.startsWith("WORKSPACE_SESSIONID"));
					workspaceClient.defaultHeaders["Cookie"] = sessionCookie;
					console.log("Got workspace session id");
				
					//region CometD
					//Now that we have our workspace session ID we can start cometD and get initialization event.
					startCometD(workspaceUrl, apiKey, sessionCookie, (cometD) => {
						
						waitForInitializeWorkspaceComplete(cometD, (user) => {
							
							startHandlingVoiceEvents(cometD, sessionApi, voiceApi, () => {
								
								console.log("Activating channels...");
								sessionApi.activateChannels({
									data: {
										agentId: user.employeeId,
										dn: user.agentLogin
									}
								}).then((resp) => {
									
								}).catch((err) => {
									console.error("Cannot activate channels");
									console.error(err.response.text);
									process.exit(1);
								});
							});
							
						});
						
					});
					//endregion
				} else {
					console.error("Cannot initialize workspace");
					console.error("Code: " + resp.data.status.code);
				}
			
			}).catch((err) => {
				console.error("Cannot initialize workspace");
				console.error(err.response.text);
			});
		}
	
	}).catch((err) => {
		console.error("Cannot get access token");
		console.error(err.response.text);
	});
}

function startCometD(workspaceUrl, apiKey, sessionCookie, callback) {
	//region Setting up CometD
	//Setting up cometD making sure api key and session cookie are included in requests.
	const cometD = new cometDLib.CometD();
	
	const hostname = url.parse(workspaceUrl).hostname;
	const transport = cometD.findTransport('long-polling');
	transport.context = {
		cookieStore: {
			[hostname]: [sessionCookie]
		}
	};
	
	cometD.configure({
		url: workspaceUrl + "/notifications",
		requestHeaders: {
			"x-api-key": apiKey,
			"Cookie": sessionCookie
		}
	});
	
	//region CometD Handshake
	//Once the handshake is successful we can subscribe to channels.
	console.log("CometD Handshake...");
	cometD.handshake((reply) => {
		if(reply.successful) {
			console.log("Handshake successful");
			callback(cometD);
			
		} else {
			console.error("Handshake unsuccessful");
		}
	});
	
	//endregion
}

function waitForInitializeWorkspaceComplete(cometD, callback) {
	console.log("Subscribing to Initilaization channel...");
	
	//region Subscribe to Initialization Channel
	//Once the handshake is successful we can subscribe to a CometD channels to get events. 
	//Here we subscribe to initialization channel to get 'WorkspaceInitializationComplete' event.
	cometD.subscribe("/workspace/v3/initialization", (message) => {
		if(message.data.state == "Complete") {
			callback(message.data.data.user);
		}
	}, (reply) => {
		if(reply.successful) {
			console.log("Initialization subscription succesful");
		} else {
			console.error("Subscription unsuccessful");
			console.error(err.response.text);
			process.exit(1);
		}
	
	});
		
}

function startHandlingVoiceEvents(cometD, sessionApi, voiceApi, callback) {
	console.log("Subscribing to Voice channel...");
	
	//region Handling Voice Events
	//Here we subscribe to voice channel and handle voice events.
	var hasActivatedChannels = false;
	
	cometD.subscribe("/workspace/v3/voice", (message) => {
		
		if(message.data.messageType = "DnStateChanged") {
			
			if(!hasActivatedChannels) {
				if(message.data.dn.agentState == "NotReady" ) {
					console.log("Channels activated");
					console.log("Setting agent state to 'Ready'...");
					
					voiceApi.setAgentStateReady().then((resp) => {
						if(resp.data.status.code != 1) {
							console.error("Cannot set agent state to 'Ready'");
							console.error("Code: " + resp.data.status.code);
						} else {
							console.log("Agent state set to 'Ready'");
							console.log("done");
						}
						disconnectAndLogout(cometD, sessionApi);
						
					}).catch((err) => {
						console.error("Cannot set agent state to 'Ready'");
						console.error(JSON.stringify(err));
						console.error(err.response.text);
						disconnectAndLogout(cometD, sessionApi);
					});
					
					hasActivatedChannels = true;
				} else if(message.data.dn.agentState == "Ready" ) {
					console.log("Agent state is 'Ready'");
					console.log("done");
					disconnectAndLogout(cometD, sessionApi);
					
				}
			}
		}
		
		
	}, (reply) => {
		if(reply.successful) {
			console.log("Voice subscription succesful");
			callback();
		} else {
			console.error("Subscription unsuccessful");
			console.error(err.response.text);
			disconnectAndLogout(cometD, sessionApi);
		}
	
	});
}

function disconnectAndLogout(cometD, sessionApi) {
	//region Disconnect CometD and Logout Workspace
	//Disconnecting cometD and ending out workspace session.
	cometD.disconnect((reply) => {
		if(reply.successful) {
			sessionApi.logout().then((resp) => {
				
			}).catch((err) => {
				console.error("Cannot log out");
				console.error(err.response.text);
				process.exit(1);
			});
		} else {
			console.error("Cannot Disconnect CometD");
			process.exit(1);
		}
	});
	//endregion
}

function printError(err) {
	if(err.response.text) console.log(err.response.text);
}


main();