#!/bin/bash

# 遍历当前目录下的所有 .proto 文件
proto_dir="$(pwd)/src/proto"
target_dir="$(pwd)/src/generated/"
cd ${proto_dir}

for proto_file in *.proto
do
    # 移除文件扩展名，用于生成输出文件名
    echo "Generating ${proto_file}..."
    base_name=$(basename "$proto_file" .proto)

    npx pbjs --ts "${target_dir}${base_name}.ts"  "${proto_file}"
done

cd ${target_dir}

for proto_ts in *.ts
do
  base_name=$(basename "$proto_ts" .ts)

  if [ $base_name == "PBBaseCommand" ]; then
    sed -i 's/^function _encode/export function _encode/g' $proto_ts
    sed -i 's/^function _decode/export function _decode/g' $proto_ts
    continue
  else
    sed -i '1i import { _encodepbbasecommand, _decodepbbasecommand , pbbasecommand } from "./PBBaseCommand";' $proto_ts
  fi
done

cd ${proto_dir}
enum_values=$(awk '/enum InstructionType/,/}/' ./PBBaseCommand.proto | grep '=' | awk '{print $1, $3}') 
cd ${target_dir}
echo "$enum_values"
enum_str=""
while IFS= read -r line; do
    enum_name=$(echo "$line" | awk '{print $1}')
    enum_value=$(echo "$line" | awk '{print $2}' | tr -d ';')
    enum_str="${enum_str}\n  ${enum_name}=${enum_value},"
done <<< "$enum_values"  # 使用here-string将$enum_values的值传递给while循环

enum_name="export enum InstructionType {${enum_str}\n}"

sed -i '1i '"$enum_name"'' PBBaseCommand.ts
