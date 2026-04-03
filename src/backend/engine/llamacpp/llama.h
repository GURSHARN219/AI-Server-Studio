#ifndef LLAMA_H
#define LLAMA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef int32_t llama_token;
typedef int32_t llama_pos;
typedef int32_t llama_seq_id;

typedef struct llama_model llama_model;
typedef struct llama_context llama_context;
typedef struct llama_sampler llama_sampler;

typedef void * ggml_backend_dev_t;
typedef void * ggml_backend_buffer_type_t;

struct ggml_tensor;

typedef bool (*ggml_backend_sched_eval_callback)(struct ggml_tensor * tensor, bool ask, void * user_data);
typedef bool (*ggml_abort_callback)(void * user_data);

typedef struct {
    llama_token id;
    float logit;
    float p;
} llama_token_data;

typedef struct {
    llama_token_data * data;
    size_t size;
    int64_t selected;
    bool sorted;
} llama_token_data_array;

typedef bool (*llama_progress_callback)(float progress, void * user_data);

typedef struct {
    const char * pattern;
    ggml_backend_buffer_type_t buft;
} llama_model_tensor_buft_override;

typedef struct {
    llama_seq_id seq_id;
    llama_sampler * sampler;
} llama_sampler_seq_config;

enum ggml_type {
    GGML_TYPE_F32 = 0,
};

enum llama_split_mode {
    LLAMA_SPLIT_MODE_NONE = 0,
    LLAMA_SPLIT_MODE_LAYER = 1,
    LLAMA_SPLIT_MODE_ROW = 2,
};

enum llama_rope_scaling_type {
    LLAMA_ROPE_SCALING_TYPE_UNSPECIFIED = -1,
    LLAMA_ROPE_SCALING_TYPE_NONE = 0,
    LLAMA_ROPE_SCALING_TYPE_LINEAR = 1,
    LLAMA_ROPE_SCALING_TYPE_YARN = 2,
    LLAMA_ROPE_SCALING_TYPE_LONGROPE = 3,
};

enum llama_pooling_type {
    LLAMA_POOLING_TYPE_UNSPECIFIED = -1,
    LLAMA_POOLING_TYPE_NONE = 0,
    LLAMA_POOLING_TYPE_MEAN = 1,
    LLAMA_POOLING_TYPE_CLS = 2,
    LLAMA_POOLING_TYPE_LAST = 3,
    LLAMA_POOLING_TYPE_RANK = 4,
};

enum llama_attention_type {
    LLAMA_ATTENTION_TYPE_UNSPECIFIED = -1,
    LLAMA_ATTENTION_TYPE_CAUSAL = 0,
    LLAMA_ATTENTION_TYPE_NON_CAUSAL = 1,
};

enum llama_flash_attn_type {
    LLAMA_FLASH_ATTN_TYPE_AUTO = -1,
    LLAMA_FLASH_ATTN_TYPE_DISABLED = 0,
    LLAMA_FLASH_ATTN_TYPE_ENABLED = 1,
};

typedef struct {
    ggml_backend_dev_t * devices;
    const llama_model_tensor_buft_override * tensor_buft_overrides;
    int32_t n_gpu_layers;
    enum llama_split_mode split_mode;
    int32_t main_gpu;
    const float * tensor_split;
    llama_progress_callback progress_callback;
    void * progress_callback_user_data;
    const void * kv_overrides;
    bool vocab_only;
    bool use_mmap;
    bool use_direct_io;
    bool use_mlock;
    bool check_tensors;
    bool use_extra_bufts;
    bool no_host;
    bool no_alloc;
} llama_model_params;

typedef struct {
    uint32_t n_ctx;
    uint32_t n_batch;
    uint32_t n_ubatch;
    uint32_t n_seq_max;
    int32_t n_threads;
    int32_t n_threads_batch;
    enum llama_rope_scaling_type rope_scaling_type;
    enum llama_pooling_type pooling_type;
    enum llama_attention_type attention_type;
    enum llama_flash_attn_type flash_attn_type;
    float rope_freq_base;
    float rope_freq_scale;
    float yarn_ext_factor;
    float yarn_attn_factor;
    float yarn_beta_fast;
    float yarn_beta_slow;
    uint32_t yarn_orig_ctx;
    float defrag_thold;
    ggml_backend_sched_eval_callback cb_eval;
    void * cb_eval_user_data;
    enum ggml_type type_k;
    enum ggml_type type_v;
    ggml_abort_callback abort_callback;
    void * abort_callback_data;
    bool embeddings;
    bool offload_kqv;
    bool no_perf;
    bool op_offload;
    bool swa_full;
    bool kv_unified;
    llama_sampler_seq_config * samplers;
    size_t n_samplers;
} llama_context_params;

typedef struct {
    int32_t n_tokens;
    llama_token * token;
    float * embd;
    llama_pos * pos;
    int32_t * n_seq_id;
    llama_seq_id ** seq_id;
    int8_t * logits;
} llama_batch;

void llama_backend_init(void);
void llama_backend_free(void);

llama_model_params llama_model_default_params(void);
llama_model * llama_load_model_from_file(const char * path_model, llama_model_params params);
void llama_free_model(llama_model * model);

llama_context_params llama_context_default_params(void);
llama_context * llama_new_context_with_model(llama_model * model, llama_context_params params);
void llama_free(llama_context * ctx);

int32_t llama_tokenize(const llama_model * model, const char * text, int32_t text_len, llama_token * tokens, int32_t n_max_tokens, bool add_bos, bool special);
int32_t llama_token_to_piece(const llama_model * model, llama_token token, char * buf, int32_t length, int32_t lstrip, bool special);

llama_batch llama_batch_get_one(llama_token * tokens, int32_t n_tokens, int32_t n_past, int32_t seq_id);
int llama_decode(llama_context * ctx, llama_batch batch);

float * llama_get_logits_ith(llama_context * ctx, int32_t i);
int32_t llama_n_vocab(const llama_model * model);
llama_model * llama_get_model(llama_context * ctx);

llama_token llama_token_bos(const llama_model * model);
llama_token llama_token_eos(const llama_model * model);
llama_token llama_token_nl(const llama_model * model);

int32_t llama_get_kv_cache_token_count(const llama_context * ctx);

void llama_sample_top_k(llama_context * ctx, llama_token_data_array * candidates, int k, size_t min_keep);
void llama_sample_top_p(llama_context * ctx, llama_token_data_array * candidates, float p, size_t min_keep);
void llama_sample_temp(llama_context * ctx, llama_token_data_array * candidates, float temp);
llama_token llama_sample_token(llama_context * ctx, llama_token_data_array * candidates);

#ifdef __cplusplus
}
#endif

#endif
