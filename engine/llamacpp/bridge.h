#ifndef BRIDGE_H
#define BRIDGE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* llama_model_ptr;
typedef void* llama_context_ptr;

typedef struct {
    int32_t n_threads;
    int32_t n_ctx;
    int32_t n_batch;
    int32_t n_gpu_layers;
    bool use_mmap;
    bool use_mlock;
    bool embeddings;
} llama_bridge_params;

typedef struct {
    int32_t top_k;
    float top_p;
    float temp;
    float repeat_penalty;
} llama_bridge_sampler_params;

void bridge_backend_init(void);
void bridge_backend_free(void);
int bridge_redirect_stderr(const char* path);

int32_t bridge_token_bos(llama_model_ptr model);
int32_t bridge_token_eos(llama_model_ptr model);
int32_t bridge_token_nl(llama_model_ptr model);
int32_t bridge_get_kv_count(llama_context_ptr ctx);

llama_model_ptr bridge_load_model(const char* path, llama_bridge_params params);
void bridge_free_model(llama_model_ptr model);

llama_context_ptr bridge_new_context(llama_model_ptr model, llama_bridge_params params);
void bridge_free_context(llama_context_ptr ctx);

int32_t bridge_tokenize(llama_model_ptr model, const char* text, int32_t* tokens, int32_t n_max_tokens, bool add_bos, bool parse_special);
int32_t bridge_detokenize(llama_model_ptr model, int32_t token, char* text, int32_t n_max_len);

int32_t bridge_decode(llama_context_ptr ctx, int32_t* tokens, int32_t n_tokens, int32_t n_past);
int32_t bridge_sample(llama_context_ptr ctx, llama_bridge_sampler_params params);

#ifdef __cplusplus
}
#endif

#endif
