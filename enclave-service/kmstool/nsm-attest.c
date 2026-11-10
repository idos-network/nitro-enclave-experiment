/*
 * nsm-attest <nonce-hex> <public-key-hex>: writes this enclave's attestation document
 * (COSE_Sign1 CBOR signed by the Nitro hypervisor) to stdout. Either argument may be
 * empty. Built in the kmstool stage of the Dockerfile against libnsm.so from
 * aws-nitro-enclaves-nsm-api, the same library kmstool_enclave_cli uses for /dev/nsm.
 */
#include <nsm.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t unhex(const char *hex, uint8_t *out, size_t cap) {
  size_t n = strlen(hex);
  if (n % 2 != 0 || n / 2 > cap) {
    fprintf(stderr, "nsm-attest: bad hex argument\n");
    exit(2);
  }
  for (size_t i = 0; i < n / 2; i++) {
    if (sscanf(hex + 2 * i, "%2hhx", &out[i]) != 1) {
      fprintf(stderr, "nsm-attest: bad hex argument\n");
      exit(2);
    }
  }
  return (uint32_t)(n / 2);
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: nsm-attest <nonce-hex> <public-key-hex>\n");
    return 2;
  }

  /* NSM limits: nonce and user_data 512 bytes, public_key 1024; documents stay under 16 KiB */
  uint8_t nonce[512], pub_key[1024], doc[16384];
  uint32_t nonce_len = unhex(argv[1], nonce, sizeof nonce);
  uint32_t pub_key_len = unhex(argv[2], pub_key, sizeof pub_key);
  uint32_t doc_len = sizeof doc;

  int32_t fd = nsm_lib_init();
  if (fd < 0) {
    fprintf(stderr, "nsm-attest: cannot open /dev/nsm\n");
    return 1;
  }

  ErrorCode err = nsm_get_attestation_doc(fd, NULL, 0, nonce_len ? nonce : NULL, nonce_len,
                                          pub_key_len ? pub_key : NULL, pub_key_len, doc, &doc_len);
  nsm_lib_exit(fd);
  if (err != ERROR_CODE_SUCCESS) {
    fprintf(stderr, "nsm-attest: GetAttestationDoc failed with error %d\n", (int)err);
    return 1;
  }

  return fwrite(doc, 1, doc_len, stdout) == doc_len ? 0 : 1;
}
