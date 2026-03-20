# FaceSign service

## API description

Most of the methods are using `/process-request` of FaceTec SDK.
Methods are mapped to status response codes in this favor:

* 200 - standard session from facetec
* 201 - success response
* 400 - recoverable error
* 409 - non-recoverable error
* 500 - facetec error

### POST /relay/liveness

**Inputs:**
   * requestBlob - facetec stuff
   * faceVector - optional (default: true)
   * onboardFaceSign - optional (default: false)
   * storeSelfie - optional (default: false)
  
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
  userId: "user-uuid",

  // When FaceSign onboarding is required
  faceSign: {
    newUser: boolean, // user has been created, no profile
    userId: string,
    userAttestmentToken: string,
  },

  // When storeSelfie is true
  selfieFileId: "selfie-file-image-id"
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

### POST /relay/uniqueness

**Inputs:**
   * requestBlob - facetec stuff
   * groupName - required
   * faceVector - optional (default: true)
   * onboardFaceSign - optional (default: false)
   * storeSelfie - optional (default: false)
  
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
  userId: "user-uuid",

  // When FaceSign onboarding is required
  faceSign: {
    newUser: boolean, // user has been created, no profile
    userId: string,
    userAttestmentToken: string,
  },

  // When storeSelfie is true
  selfieFileId: "audit-trail-image-id"
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

### POST /relay/match

**Inputs:**
   * userId - to whom we should match
   * requestBlob - facetec stuff
   * storeSelfie - optional (default: false)
  
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

  // Image (when storeSelfie is true)
  selfieFileId: "uuid"
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
  userId: "user-uuid",
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
  userId: "user-uuid",
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
  userId: "UUID",
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

# GET /relay/selfie/:selfieFileId

1. This endpoint returns base64 audit trail image if available (status: **200**):

```
[base64string]
```

2. No image available (status: **404**):

```javascript
{
  error: "No selfie image was found."
}
```

# POST /relay/match-id-doc

**Inputs:**
   * userId - required
   * image - base64 string image
   * minLevelMatch - optional (default: 7 - max)


1. Ok path (status: **200**):

```javascript
{
  success: true,
  didError: false,
  result: { matchLevel: 7 },
}
```

2. Not match
```
{
  success: false,
  didError: false,
  result: { matchLevel: 2 },
}
```
