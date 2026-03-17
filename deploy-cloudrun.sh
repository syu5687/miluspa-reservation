#!/bin/bash
# =============================================
#  MiluSpa — Cloud Run デプロイスクリプト
#  実行前に PROJECT_ID を書き換えてください
# =============================================

PROJECT_ID="miluspa"          # ← Firebase/GCPのプロジェクトID
SERVICE_NAME="miluspa-web"    # Cloud Run サービス名
REGION="asia-northeast1"      # 東京リージョン
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🔨 Dockerイメージをビルド中..."
docker build -t ${IMAGE} .

echo "📤 Container Registry にプッシュ中..."
docker push ${IMAGE}

echo "🚀 Cloud Run にデプロイ中..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --project ${PROJECT_ID}

echo "✅ デプロイ完了！"
echo "URL: https://${SERVICE_NAME}-$(gcloud config get-value project)-${REGION}.run.app"
