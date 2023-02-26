/*
	UIA/3
	Brightree API
	2018-10-09 gbk
*/

const soap = require('strong-soap').soap;
const fs = require('fs');
const log4js = require('log4js');
var logger = log4js.getLogger('Brightree-API');
const process = require('process');
const path = require('path');
const axios = require('axios');

var StrictMode = true;
function Strict(val) {
	StrictMode = val;
}

function SetLogger(l) {
	logger = l;
}

var StatsServer = null;
function SetStatsServer(domain) {
	StatsServer = domain;
}

// 2020-01-17; Warehouse connection object for logging
var DWClient = null;
var Caller = null;
function DW(Client) {
	DWClient = Client;
	Caller = path.basename(process.argv[1]);
}


function defined(val) {
	if(typeof(val) == 'undefined') return false;
	return true;
}

var CachePath = __dirname+'/wsdl-cache';
function Cache(Path) {
	CachePath = Path;
}

var ParentPath = {
	CustomFieldService: 'CustomFieldService',
	DoctorService: 'DoctorService',
	DocumentManagementService: 'DocumentationService',
	DocumentationService: 'DocumentationService',
	InsuranceService: 'OrderEntryService',
	InventoryService: 'InventoryService',
	InvoiceService: 'InvoiceService',
	PatientService: 'OrderEntryService',
	PickupExchangeService: 'OrderEntryService',
	ReferenceDataService: 'ReferenceDataService',
	SalesOrderService: 'OrderEntryService',
	UserSecurityService: 'SecurityService',
	PricingService: 'InventoryService'
};

async function GetWSDL(Service,Version,User,Password) {
	var file = `${CachePath}/${Service}-${Version}.xml`;

	if(fs.existsSync(file)) {
		return file;
	}

	if(!ParentPath.hasOwnProperty(Service)) {
		throw error (`Service "${Service}" is unsupported`);
	}

	if(!fs.existsSync(CachePath)) {
		fs.mkdirSync(CachePath);
	}

	// we don't have a copy yet, we'll have to download it.
	logger.info(`[GetWSDL] fetching ${Service} version ${Version}`);
	var url = `https://webservices.brightree.net/${Version}/${ParentPath[Service]}/${Service}.svc?singleWsdl`;
	logger.debug(url);
	var Res = await axios.get(url, {
		auth: {
			username: User,
			password: Password
		}
	}).catch(e => {
		logger.error(`[GetWSDL] ${e}`);
	});
	logger.info(`[GetWSDL] got ${Res.data.toString().length} bytes`);
	//console.log(Res);
	
	fs.writeFileSync(file,Res.data.toString());
	return file;
}


// compile a WSDL file into a SOAP client
function CompileService(Service,Version,User,Password) {

	// // WSDL files are stashed in this module folder under 'wsdl/'
	// var file = __dirname+'/wsdl/'+Service+'.xml';

	// // if we're being asked for a non-existent service
	// if(!fs.existsSync(file)) {
	// 	throw new Error(`WSDL file for requested service "${Service}" does not exist`);
	// }

	// compile the client
	return new Promise(async function(pass) {

		var file = await GetWSDL(Service,Version,User,Password);

		soap.createClient(file,{},function(err,client) {
			client.setSecurity(new soap.BasicAuthSecurity(User, Password));
			pass(client);
		});
	});

}


function CompileMethod(Service,MethodName) {
	//logger.debug(`Building wrapper for "${MethodName}"`);
	var method = Service[MethodName];
	return async function(obj) {
		//logger.debug(`Calling wrapped method "${MethodName}"`);
		logger.debug(MethodName);
		var StartTime = new Date().valueOf();
		const {result} = await method(obj);
		var EndTime = new Date().valueOf();
		//logger.debug('Done calling wrapped method');
		//logger.debug(Service.lastRequest);

		//console.log(JSON.stringify(result,undefined,4));

		// grab the top-level BrightreeID, if any
		var BrightreeID = null;
		if(obj.hasOwnProperty('BrightreeID')) {
			BrightreeID = obj.BrightreeID;
		} else if(obj.hasOwnProperty('brightreeID')) {
			BrightreeID = obj.brightreeID;
		}

		// if we have a Warehouse client
		if(DWClient != null) {
			//logger.debug('logging the call');

			await DWClient.Query('insert into BTAPILog(Interface,Caller,BrightreeID,Duration) values (?,?,?,?)',[
				MethodName,
				Caller,
				BrightreeID,
				EndTime - StartTime
			]);
		} else if(StatsServer !== null) {

			try {
				var Res = await axios.get(`https://${StatsServer}/api/BTAPILog.pl?Interface=${MethodName}&Caller=${Caller}&BrightreeID=${BrightreeID}&Duration=${EndTime-StartTime}`)
					.catch(e => {
						logger.error(`BTAPILog.pl: ${e}`);
					});
				logger.debug(`BTAPILog.pl: ${JSON.stringify(Res.data)}`);
			} catch(e) {
				logger.error(`BTAPILog.pl: ${e}`);
			}

		}

		return Result(result);
	};
}

// determine the nature of the response
/*
returns: {
	Responded: (boolean),  <-- did the API respond?
	Success: (boolean),  <-- was this call successful?
	Transient: (boolean), <-- is this a permanent error
	ItemCount: (integer), <-- the number of items returned
	TotalItemCount (integer), <-- the total number of results
	Items: (array)  <-- an array of results
}

*/
function Result(res) {
	
	// did the server even respond? This is a transient error
	if(!defined(res) || res == null) {
		logger.error('No response');

		if(StrictMode) throw new Error('No response from the Brightree API');

		return {Responded: false,
			Success: false,
			Transient: true,
			Error: 'No response from the API'};
	}

	// ok, lets grab the response data
	var Data = res[Object.keys(res)[0]];

	// if there's no Success indicator
	if(!defined(Data.Success)) {
		logger.error('No Success indicator');

		if(StrictMode) throw new Error('No Success indicator in response from the Brightree API');

		return {Responded: true, Success: false, Transient: false,
			Error: 'API response lacks a Success indicator' };
	}

	// if we're unsuccessful
	if(Data.Success != true) {
		logger.error('Request was unsuccessful');

		// and there's no Messages block
		if(!defined(Data.Messages)) {
			logger.error('No Messages specified');

			if(StrictMode) throw new Error('Brightree API call failed but no Messages were returned');

			return {Responded: true, Success: false, Transient: false,
				Error: 'API call failed but no Messages were returned' };
		}

		// extract the message(s)
		var msg = Data.Messages;
		//console.log(JSON.stringify(Data.Messages,undefined,4));
		var Message = '';
		if(Array.isArray(msg.string)) {
			for(var i=0;i<msg.string.length;i++) {
				if(Message != msg.string[i])
					Message += msg.string[i];
			}
		} else {
			Message = msg.string;
		}

		logger.debug(Message);

		if(Message.toLowerCase().indexOf('rerun the transaction') != -1) {
			logger.error('Transaction lock');
			return {Responded: true, Success: false, Transient: true,
				Error: Message };
		} else {

			if(StrictMode) throw new Error('Brightree API call failed: '+Message);

			return {Responded: true, Success: false, Transient: false,
				Error: Message };
		}
	}

	var Return = {
		Responded: true,
		Success: true,
		Transient: false,
		Items: [],
		ItemCount: 0,
		TotalItemCount: Data.TotalItemCount,
		UpdatedDataKey: Data.UpdatedDataKey
	};
	if(defined(Data.Items)) {
		// extract the results
		var Items = Data.Items[Object.keys(Data.Items)[0]];
		
		Return.Items = (Array.isArray(Items)) ? Items : [Items];
		Return.ItemCount = Return.Items.length;
	} else if(defined(Data.Item)) {
		Return.Items = [Data.Item];
	}


	return Return;
}

// given an object, ensure that it's an array
// if the object is already an array, return the object
// if the object is not an array, return it as the sole element of a new array
function AsArray(obj) {
	if(Array.isArray(obj)) return obj;
	return [obj];
}

module.exports = {
	Strict,
	SetLogger,
	DW,
	CompileService,
	CompileMethod,
	Result,
	AsArray
};
