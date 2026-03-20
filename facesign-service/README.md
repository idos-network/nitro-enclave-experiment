# FaceSign service

## API description

All methods are using `/process-request` of FaceTec SDK.
Methods are mapped to status response codes in this favor:

* 200 - standard session from facetec
* 201 - success response
* 400 - recoverable error
* 409 - non-recoverable error
* 500 - facetec error

### POST /login

**Inputs:**
   * requestBlob - facetec stuff
   * groupName - optional (default: null)
   * faceVector - optional (default: true)
   * onboardFaceSign - optional (default: false)
   * storeAuditTrailImages - optional (default: false)
  
**Outputs:**

1. SessionStarted (status: **200**) - FaceTec internals, no success, just responseBlob

```javascript
{
  responseBlob: "string"
}
```

2. New user login or reused user login (status: **201**)

- this is a happy path scenario

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign userId (when groupName is provided)
  faceSignUserId: "user-uuid",

  // When FaceSign onboarding is required
  faceSign: {
    newUser: boolean, // user has been created, no profile
    faceSignUserId: string,
    userAttestmentToken: string,
  },

  // When storeAuditTrailImages is true
  auditTrailImageId: "audit-trail-image-id"
}
```

3. User login failed or liveness was not proven (status: **400**)

- this is a recoverable error, the user have to start again

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign service customs
  errorMessage: "Liveness check or enrollment 3D failed and was not processed."
}
```

4. Login duplicate error (multiple results - status: **409**)

- this is a FFR issue during deduplication, nothing much we can do about
- the 409 response has been chosen, to not conflict with 500 from facetec
- this is non-recoverable error

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign service customs
  errorMessage: "Login process failed, check server logs: Multiple users found with the same face-vector."
}
```

### POST /match


**Inputs:**
   * requestBlob - facetec stuff
   * externalDatabaseRefID - to whom we should match
   * storeAuditTrailImages - optional (default: false)
  
**Outputs:**

1. SessionStarted (status: **200**) - FaceTec internals, no success, just responseBlob

```javascript
{
  responseBlob: "string"
}
```

2. 3d-3d match has been done (status: **201**)

- this is a correct response

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
    matchLevel: number,
  },

  // Image (when storeAuditTrailImages is true)
  storeAuditTrailImages: "uuid"
}
```

3. User verification failed or liveness was not proven (status: **400**)

- this is a recoverable error, the user have to start again

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign service customs
  errorMessage: "Liveness check or enrollment 3D failed and was not processed."
}
```

4. Liveness proven, but no match (status: **409**)

- this is non recoverable error, matching has been done, but with no success

```javascript
{
  // FaceTec standard response
  success: false,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: true,
    matchLevel: 0, // not sure about this
  },
}
```

### POST /facesign

1. SessionStarted (status: **200**) - FaceTec internals, no success, just responseBlob

```javascript
{
  responseBlob: "string"
}
```

2a. Existing user (status: **201**)

- this is a happy path scenario

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign service customs
  faceSignUserId: "user-uuid",
  userAttestmentToken: "jwt token for entropy service",
}
```

2b. New user (status: **200**)

- this is a happy path scenario if user is new, because of FFR we can't be 100% sure, so we have to ask and than confirm with confirmationToken

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign service customs
  faceSignUserId: "user-uuid",
  newUserConfirmationToken: "jwt token to confirm users creation",
}
```

1. User login failed or liveness was not proven (status: **400**)

- this is a recoverable error, the user have to start again

```javascript
{
  // FaceTec standard response
  success: true,
  didError: false,
  responseBlob: "string",
  additionalSessionData: {
    platform: "string",
    deviceModel: "string",
    userAgent: "string",
  },
  result: {
    livenessProven: boolean,
  },

  // FaceSign service customs
  errorMessage: "Liveness check or enrollment 3D failed and was not processed."
}
```

# POST /facesign/confirmation

This endpoint is when user clicks on `I am a new user`.

Body:

```javascript
{
  newUserConfirmationToken: "token from facesign", 
}
```

1. This is a ideal case scenario (status: **201**):

```javascript
{
  faceSignUserId: "UUID",
  userAttestmentToken: "token for entropy service",
}
```

2. Token expired, invalid format (status: **400**):

```javascript
{
  errorMessage: "JWT token expired",
}
```

3. User has been already onboarded (status: **409**):

```javascript
{
  errorMessage: "User already exists",
}
```

# GET /audit-trail-image/:auditTrailImageId

1. This endpoint returns base64 audit trail image if available (status: **200**):

```
[base64string]
```

2. No image available (status: **400**):

```javascript
{
  error: "No audit trail image available."
}
```
