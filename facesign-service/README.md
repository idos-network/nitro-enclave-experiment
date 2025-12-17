# FaceSign service

## API description

All methods are using `/process-request` of FaceTec SDK.

### POST /login

**Inputs:**
   * requestBlob - facetec stuff
   * groupName - optional
   * faceVector - optional (default: true)
  
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

  // FaceSign service customs
  faceSignUserId: "user-uuid",
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

- this is a FAR issue, nothing much we can do about
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

1. SessionStarted (status: **200**) - FaceTec internals, no success, just responseBlob

```javascript
{
  responseBlob: "string"
}
```

2. User verification failed or liveness was not proven (status: **400**)

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

3. 3d-3d match has been done (status: **201**)

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
}
```

4. Liveness proven, but no match (status: **409**)

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

### POST /pinocchio

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

  // FaceSign service customs
  faceSignUserId: "user-uuid",
  token: "jwt token for entropy service",
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
