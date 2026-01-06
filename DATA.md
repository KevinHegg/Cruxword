# DATA Dictionary (starter)

## basellex_v0.1.csv
- word (string)
- pos (string)
- zipf (number)
- flags (string)
- theme_tags (string)

## playdict.csv
- word (string)
- is_clueable (boolean-ish; accepts 1/0, true/false, yes/no)

## segments.csv / segments-LIB-24-5576.csv
- text (string)
- len (number)
- combo_count (number)
- is_syntactic (boolean-ish)
- morph_prefix (string|null)
- morph_suffix (string|null)
- pos_start (number)
- pos_end (number)
- atomic_slice (string|null)
- semantic_weight (number|null)
- game_weight (number|null)
- start_combo_count (number|null)
