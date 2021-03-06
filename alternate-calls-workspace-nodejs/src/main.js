const WorkspaceApi = require('genesys-workspace-client-js');
const argv = require('yargs').argv;

//region Create the api object
//Create the api object passing the parsed command line arguments.
let api = new WorkspaceApi(argv.apiKey, argv.baseUrl, argv.debugEnabled);
//endregion

async function main() {
	try {
		//region Register event handler
    	//Register event handler to get notifications of call state changes and find held and established calls.
    	var isAlternating = false;
    	var heldCall;
    	var establishedCall;
    	var actionsCompleted = 0;
    	
    	api.on('CallStateChanged', async msg => {
    		console.log(msg);
    		let call = msg.call;
    		if(!isAlternating) {
				switch(call.state) {
					case 'Established':
						console.log(`Found established call: [${call.id}]`);
						establishedCall = call;
						break;
					case 'Held':
						console.log(`Found held call: [${call.id}]`);
						if(establishedCall) if(establishedCall.id == call.id) {
							establishedCall = undefined;
							console.log('(Established call is now held)');
						}
						heldCall = call;
				}
    		
				if(establishedCall && heldCall) {
					console.log(`Found held call: [${heldCall.id}] and established call: [${establishedCall.id}]`);
					console.log('Alternating...');
					isAlternating = true;
					await api.voice.alternateCalls(establishedCall.id, heldCall.id);
				
				} 
    		} else if(isAlternating) {
    			
    			if(call.state == 'Established' && call.id == heldCall.id) {
    				console.log(`Call retrieved: [${call.id}]`);
    				actionsCompleted ++;
    			}
    			
    			if(call.state == 'Held' && call.id == establishedCall.id) {
    				console.log(`Call held: [${call.id}]`);
    				actionsCompleted ++;
    			}
    			
    			if(actionsCompleted == 2) {
    				console.log('Calls alternated');
    				console.log('done');
    				await api.destroy();
    			}
    			
    		}
    		
    	});
    	//endregion
    	const code = await getAuthCode();
        //region Initiaize the API and activate channels
        //Initialize the API and activate channels
        console.log('Initializing API...');
        await api.initialize({code: code, redirectUri: 'http://localhost'});
		console.log('Activating channels...');
		await api.activateChannels(api.user.employeeId, api.user.agentLogin);
	
		//region Wait for held and established calls
		//The tutorial waits for held and established calls to alternate.
		console.log('Waiting for held and established calls to alternate...');
		
	} catch(err) {
		console.error(err);
		api.destroy();
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