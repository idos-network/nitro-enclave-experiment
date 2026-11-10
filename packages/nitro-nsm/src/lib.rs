//! Node addon for the Nitro Secure Module: one call, the attestation document.
//!
//! Trimmed from https://github.com/PrivadoID/aws-nitro-enclaves-nsm-node at 456c6ca (MIT, see
//! LICENSE), a napi-rs wrapper around AWS's aws-nitro-enclaves-nsm-api crate. Node has no
//! ioctl, so talking to /dev/nsm needs native code.

use aws_nitro_enclaves_nsm_api::api::{Request, Response};
use aws_nitro_enclaves_nsm_api::driver::{nsm_exit, nsm_init, nsm_process_request};
use napi::bindgen_prelude::Buffer;
use napi::{Error, Result};
use napi_derive::napi;
use serde_bytes::ByteBuf;

/// COSE_Sign1 attestation document signed by the Nitro hypervisor. NSM limits: `user_data`
/// and `nonce` 512 bytes, `public_key` 1024 bytes.
#[napi]
pub fn get_attestation_doc(
  user_data: Option<Buffer>,
  nonce: Option<Buffer>,
  public_key: Option<Buffer>,
) -> Result<Buffer> {
  let fd = nsm_init();
  if fd < 0 {
    return Err(Error::from_reason("cannot open /dev/nsm"));
  }

  let bytes = |buffer: Option<Buffer>| buffer.map(|b| ByteBuf::from(b.to_vec()));
  let response = nsm_process_request(
    fd,
    Request::Attestation {
      user_data: bytes(user_data),
      nonce: bytes(nonce),
      public_key: bytes(public_key),
    },
  );
  nsm_exit(fd);

  match response {
    Response::Attestation { document } => Ok(document.into()),
    Response::Error(code) => Err(Error::from_reason(format!("NSM error: {:?}", code))),
    _ => Err(Error::from_reason("unexpected NSM response")),
  }
}
