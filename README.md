# brightree-api

NodeJS interface to the Brightree API

## Requires

1. strong-soap
2. log4js
3. axios

## Methods

### Strict(bool)

Set the module's operating mode. Strict is enabled by default; any API call
that does not get a Success response will be handled by throwing an exception.

If Strict mode is disabled then each API response should be individually
inspected for the Success bool.

### DW(Client)

Sets the MySQL connection object to the Data Warehouse (see brightree-warehouse).
This connection will be used to log API usage.
If this handle is not specified then the call will be logged via HTTPS.

### async CompileService(Service,Version,Username,Password)

Compiles the specified WSDL Service/Version and attaches the specified
authentication credentials.

Example services:
- CustomFieldService
- DoctorService
- DocumentationService
- DocumentManagementService
- InsuranceService
- InventoryService
- PatientService
- PickupExchangeService
- ReferenceDataService
- SalesOrderService

Version identifiers are in the form of `v100-1908`. Note that you *must*
specify a valid API version or the compile process will fail.

The WSDL spec for the requested service/version will be fetched via HTTPS
directly from Brightree's servers, and then cached locally for later use.

Usage:

```
	 const BTAPI = require('brightree-api');
	 const SalesOrderService = await BTAPI.CompileService('SalesOrderService','v100-1908',
	 USERNAME,PASSWORD);
```

### CompileMethod(Service,MethodName)

Compiles a method handle. Expects a compiled service (from CompileService) and
a method name.

Usage:

```
	const BTAPI = require('brightree-api');
	const SalesOrderService = await BTAPI.CompileService('SalesOrderService','v100-1908',
	 USERNAME,PASSWORD);
	const SalesOrderFetchByBrightreeID = BTAPI.CompileMethod(SalesOrderService,'SalesOrderFetchByBrightreeID');
```

At that point, using the compiled method can be done as follows:

```
	var Res = await SalesOrderFetchByBrightreeID({
		BrightreeID: SOKey
	});
```

The normalized response model looks like this:

```
{
	"Responded": <bool>, // (required) did the API return any data?
	"Success": <bool>,  // (required) did the response indicate success?
	"Transient": <bool>,  // (required) if unsuccessful, was the error temporary?
	"Error": <string>,  // if unsuccessful, what error message did the API return?
	// the remaining fields are only present for Successful responses
	"Items": <array>,  // response records
	"ItemCount":  <integer>,  // the number of records returned in the response
	"TotalItemCount": <integer>,  // the total number of available records available for the request
	"UpdatedDataKey": <integer>  // if the request resulted in the creation of a new record, this field should contain the new BrightreeID
}
```

