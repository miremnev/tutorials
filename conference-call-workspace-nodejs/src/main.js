const WorkspaceApi = require('genesys-workspace-client-js');
const argv = require('yargs').argv;

if(!argv.destination) {
	console.log("This tutorial requires input param: 'destination'");
	process.exit();
}

//region Create the api object
//Create the api object passing the parsed command line arguments.
let api = new WorkspaceApi(argv);
//endregion

async function main() {
	try {
		
    	var parentCall;
    	var consultCall;
    	var initiatingConference = false;
    	var completingConference = false;
    	//region Register event handler
    	//Register event handler to get notifications of call state changes.
    	api.on('CallStateChanged', async msg => {
    		
    		try {
    			let call = msg.call;
    			if(!initiatingConference) {
					if(!parentCall && call.state == 'Established') {
						parentCall = call;
						console.log(`Found established call: [${call.id}]`);
						console.log('Initiating Conference...');
						initiatingConference = true;
						const response = await api.voice.initiateConference(call.id, argv.destination + '');
					}
    			} else {
					if(call.state == 'Held' && call.id == parentCall.id) {
						console.log(`Held call: [${call.id}]`);
					}
					if(call.state == 'Dialing') {
						console.log(`Calling consultant: [${call.id}]`);
						consultCall = call;
					}
					if(consultCall) 
						if(call.state == 'Established' && call.id == consultCall.id) {
							console.log(`Consult call answered: [${call.id}]]`);
							console.log('Completing conference...');
							completingConference = true;
							await api.voice.completeConference(consultCall.id, parentCall.id);
						}
    			}
    			
    			if(completingConference) {
    				if(call.state == 'Released' && call.id == consultCall.id) {
    					console.log(`Consult call released: [${call.id}]`);
    					console.log('Conference complete');
    					console.log('done');
    					await api.destroy();
    				}
    			}
    			
    		} catch(err) {
    			console.error(err);
    			api.destroy();
    		}
    	});
    	//endregion
    	
    	//region Initiaize the API and activate channels
		//Initialize the API and activate channels
		console.log('Initializing API...');
		await api.initialize();
		console.log('Activating channels...');
		await api.activateChannels(api.user.employeeId, api.user.agentLogin);
		
		//region Wait for an established call
		//The tutorial waits for an established call so it can initiate conference
		console.log('Waiting for an established call...');
		
	} catch(err) {
		console.error(err);
		api.destroy();
	}
	
	
	
}

main();