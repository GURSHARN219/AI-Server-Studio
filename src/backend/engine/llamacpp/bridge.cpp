#include "bridge.h"
#include "llama.h"
#include <vector>
#include <cstring>
#include <cfloat>
#ifdef _WIN32
#include <windows.h>
#endif

extern "C" {
    
int32_t bridge_token_bos(llama_model_ptr model) { return llama_token_bos((llama_model*)model); }
int32_t bridge_token_eos(llama_model_ptr model) { return llama_token_eos((llama_model*)model); }
int32_t bridge_token_nl(llama_model_ptr model) { return llama_token_nl((llama_model*)model); }
int32_t bridge_get_kv_count(llama_context_ptr ctx) {
    (void)ctx;
    // This llama.dll build does not export kv-cache token count APIs.
    // Return 0 so higher-level code can continue safely.
    return 0;
}

void bridge_backend_init(void) {
#ifdef _WIN32
    if (HMODULE ggml = LoadLibraryA("ggml.dll")) {
        using ggml_backend_load_all_fn = void (*)(void);
        using ggml_backend_load_all_from_path_fn = void (*)(const char *);

        char ggml_path[MAX_PATH] = {0};
        const DWORD ggml_path_len = GetModuleFileNameA(ggml, ggml_path, MAX_PATH);
        if (ggml_path_len > 0 && ggml_path_len < MAX_PATH) {
            for (int i = (int)ggml_path_len - 1; i >= 0; --i) {
                if (ggml_path[i] == '\\' || ggml_path[i] == '/') {
                    ggml_path[i] = '\0';
                    break;
                }
            }

            if (auto load_all_from_path = (ggml_backend_load_all_from_path_fn) GetProcAddress(ggml, "ggml_backend_load_all_from_path")) {
                load_all_from_path(ggml_path);
            } else if (auto load_all = (ggml_backend_load_all_fn) GetProcAddress(ggml, "ggml_backend_load_all")) {
                load_all();
            }
        } else if (auto load_all = (ggml_backend_load_all_fn) GetProcAddress(ggml, "ggml_backend_load_all")) {
            load_all();
        }
    }
#endif
    llama_backend_init();
}

void bridge_backend_free(void) {
    llama_backend_free();
}

llama_model_ptr bridge_load_model(const char* path, llama_bridge_params params) {
    auto mparams = llama_model_default_params();
    mparams.n_gpu_layers = params.n_gpu_layers;
    mparams.use_mmap = params.use_mmap;
    mparams.use_mlock = params.use_mlock;

    return (llama_model_ptr)llama_load_model_from_file(path, mparams);
}

void bridge_free_model(llama_model_ptr model) {
    llama_free_model((llama_model*)model);
}

llama_context_ptr bridge_new_context(llama_model_ptr model, llama_bridge_params params) {
    auto cparams = llama_context_default_params();
    cparams.n_ctx = params.n_ctx;
    cparams.n_batch = params.n_batch;
    cparams.n_threads = params.n_threads;
    cparams.embeddings = params.embeddings;

    return (llama_context_ptr)llama_new_context_with_model((llama_model*)model, cparams);
}

void bridge_free_context(llama_context_ptr ctx) {
    llama_free((llama_context*)ctx);
}

int32_t bridge_tokenize(llama_model_ptr model, const char* text, int32_t* tokens, int32_t n_max_tokens, bool add_bos, bool parse_special) {
    return llama_tokenize((llama_model*)model, text, std::strlen(text), (llama_token*)tokens, n_max_tokens, add_bos, parse_special);
}

int32_t bridge_detokenize(llama_model_ptr model, int32_t token, char* text, int32_t n_max_len) {
    return llama_token_to_piece((llama_model*)model, (llama_token)token, text, n_max_len, 0, false);
}

int32_t bridge_decode(llama_context_ptr ctx, int32_t* tokens, int32_t n_tokens, int32_t n_past) {
    llama_batch batch = llama_batch_get_one((llama_token*)tokens, n_tokens, n_past, 0);
    return llama_decode((llama_context*)ctx, batch);
}

int32_t bridge_sample(llama_context_ptr ctx, llama_bridge_sampler_params params) {
    (void)params;
    auto logits = llama_get_logits_ith((llama_context*)ctx, -1);
    auto n_vocab = llama_n_vocab(llama_get_model((llama_context*)ctx));

    // Greedy argmax sampling from logits. This avoids older/newer sampler API
    // compatibility issues across llama.cpp binary builds.
    llama_token best = 0;
    float best_logit = -FLT_MAX;
    for (llama_token token_id = 0; token_id < n_vocab; token_id++) {
        const float v = logits[token_id];
        if (v > best_logit) {
            best_logit = v;
            best = token_id;
        }
    }

    return best;
}

}
