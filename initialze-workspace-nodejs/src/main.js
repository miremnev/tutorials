const WorkspaceApi = require('genesys-workspace-client-js');
const argv = {};
const rl = require('readline').createInterface({
	input: process.stdin,
	output: process.stdout
});

function prompt(text) {
	return new Promise((resolve, reject) => {
		rl.question(text, resp => resolve(resp));
	});
}



async function main() {
	console.log("This tutorial steps you through setting up workspace client.");
	console.log("When running other workspace tutorials the propted inputs in this tutorial \
should be inputed as arguments (ex: --apiKey=<your api key>)");
	argv.apiKey = await prompt("apiKey:\n");
	argv.baseUrl = await prompt("baseUrl:\n");
	argv.debugEnabled = await prompt("debugEnabled \n(this tells the WorkspaceApi whether it should log errors and other activity or not):\n");
	
	//region Create the api object
	//Create the api object passing the parsed command line arguments.
	let api = new WorkspaceApi(argv.apiKey, argv.baseUrl, argv.debugEnabled);
	//endregion
	console.log("WorkspaceApi object created");
	
	argv.username = await prompt("username:\n");
	argv.password = await prompt("password:\n");
	argv.clientId = await prompt("clientId:\n");
	
	try {
		console.log("Performing Oauth 2.0...");
		console.log("Getting access code...");
		const code = await getAuthCode();
        //region Initiaize the API and activate channels
        //Initialize the API and activate channels
        console.log('Initializing API...');
        await api.initialize({code: code, redirectUri: 'http://localhost'});
        
		console.log('The workspace api is now successfully initialized.');
		console.log('User data: ' + JSON.stringify(api.user, null, 4));
		api.destroy();
		//endregion
		rl.close();
	} catch(err) {
		await api.destroy();
		rl.close();
	}
}

async function getAuthCode() {
	
	let requestOptions = {
	  url: `${argv.baseUrl}/auth/v3/oauth/authorize?response_type=code&client_id=${argv.clientId}&redirect_uri=http://localhost`,
	  headers: {
		'authorization':  'Basic ' + new Buffer(`${argv.username}:${argv.password}`).toString('base64'),
		'x-api-key': argv.apiKey
	  },
	  resolveWithFullResponse: true,
	  simple: false,
	  followRedirect: false
	}
	
	let response = await require('request-promise-native')(requestOptions);
	if (!response.headers['location']) {
	  throw {error: 'No Location Header', response: response};
	}
	
	const location = require('url').parse(response.headers['location'], true);
	let code = location.query.code;
	if(argv.debugEnabled == 'true') console.log(`Auth code is [${code}]...`);
	
	return code;
}

main();

/*
const WorkspaceApi = require('genesys-workspace-client-js');
const argv = require('yargs').argv;

//region Create the api object
//Create the api object passing the parsed command line arguments.
let api = new WorkspaceApi(argv);

async function main() {
	
	//region Initialize API Client
	//Create and setup ApiClient instance with your ApiKey and Workspace API URL.
	const workspaceClient = new workspace.ApiClient();
	workspaceClient.basePath = workspaceUrl;
	workspaceClient.defaultHeaders = { 'x-api-key': apiKey };
	workspaceClient.enableCookies = true;

	const authClient = new auth.ApiClient();
	authClient.basePath = authUrl;
	authClient.defaultHeaders = { 'x-api-key': apiKey };

	//region Create SessionApi instance
	//Creating instance of SessionApi using the ApiClient.
	const sessionApi = new workspace.SessionApi(workspaceClient);

	//region Create AuthenticationApi instance
	//Create instance of AuthenticationApi using the authorization ApiClient which will be used to retrieve access token.
	const authApi = new auth.AuthenticationApi(authClient); 
	
	let cometD;
	let loggedIn = false;
	
	try {
		//region Oauth2 Authentication
		//Performing Oauth 2.0 authentication.
		console.log("Retrieving access token...");
		const authorization = "Basic " + new String(new Buffer(clientId + ":" + clientSecret).toString("base64"));
		
		let resp = await authApi.retrieveToken("password", "openid", {
			clientId: clientId,
			username: username,
			password: password,
			authorization: authorization
		});
		
		if(!resp["access_token"]) {
			console.error("No access token");
		
		} else {
		
			console.log("Retrieved access token");
			console.log("Initializing workspace...");
	
			resp = await sessionApi.initializeWorkspaceWithHttpInfo({"authorization": "Bearer " + resp["access_token"]});
			
			//region Getting Session ID
			//If the initialize-workspace call is successful, the it will return the workspace session ID as a cookie.
			//We still must wait for 'InitializeWorkspaceComplete' cometD event in order to get user data for the user we are loggin in.
			if(resp.data.status.code == 1) {
				const sessionCookie = resp.response.header["set-cookie"].find(v => v.startsWith("WORKSPACE_SESSIONID"));
				workspaceClient.defaultHeaders["Cookie"] = sessionCookie;
				console.log("Got workspace session id");
				loggedIn = true;
				//region CometD
				//Now that we have our workspace session ID we can start cometD and get initialization event.
				cometD = await startCometD(workspaceUrl, apiKey, sessionCookie);
				
				const user = await waitForInitializeWorkspaceComplete(cometD);
				
				console.log("User: " + JSON.stringify(user));
				await disconnectAndLogout(cometD, sessionApi);
				console.log("done");
				//endregion
				
			} else {
				console.error("Error initializing workspace");
				console.error("Code: " + resp.data.status.code);
			}
			
		}
		
	} catch(err) {
		if(err.response) console.log(err.response.text);
		else console.log(err);
		
		if(loggedIn) {
			await disconnectAndLogout(cometD, sessionApi);
		}
	}
}

function startCometD(workspaceUrl, apiKey, sessionCookie) {
	return new Promise((resolve, reject) => {
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
		//Perform handshek to start cometD. Once the handshake is successful we can subscribe to channels.
		console.log("CometD Handshake...");
		cometD.handshake((reply) => {
			if(reply.successful) {
				console.log("Handshake successful");
				resolve(cometD);
			
			} else {
				console.error("Handshake unsuccessful");
				reject();
			}
		});
		//endregion
	});
}

function waitForInitializeWorkspaceComplete(cometD, callback) {
	return new Promise((resolve, reject) => {
		console.log("Subscribing to Initilaization channel...");
		//region Subscribe to Initialization Channel
		//Once the handshake is successful we can subscribe to a CometD channels to get events. 
		//Here we subscribe to initialization channel to get 'WorkspaceInitializationComplete' event.
		cometD.subscribe("/workspace/v3/initialization", (message) => {
			if(message.data.state == "Complete") {
				resolve(message.data.data.user);
			}
		}, (reply) => {
			if(reply.successful) {
				console.log("Initialization subscription succesful");
			} else {
				console.error("Subscription unsuccessful");
				reject();
			}
	
		});
	});
}

async function disconnectAndLogout(cometD, sessionApi) {
	//region Disconnect CometD and Logout Workspace
	//Disconnecting cometD and ending out workspace session.
	if(cometD) {
		await new Promise((resolve, reject) => {
			cometD.disconnect((reply) => {
				if(reply.successful) {
					resolve();
				} else {
					reject();
				}
			});
		});
	}
	
	try {
		await sessionApi.logout();
	} catch(err) {
		console.error("Could not log out");
		process.exit(1);
	}
	//endregion
}


main();
*/