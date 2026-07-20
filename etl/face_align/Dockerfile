# Define custom function directory
ARG FUNCTION_DIR="/function"

FROM python:3.11 AS build-image

ARG FUNCTION_DIR

RUN mkdir -p ${FUNCTION_DIR}
COPY lambda_function.py ${FUNCTION_DIR}
COPY blaze_face_short_range.tflite ${FUNCTION_DIR}
COPY requirements.txt ${FUNCTION_DIR}

RUN pip install --target "${FUNCTION_DIR}" -r "${FUNCTION_DIR}/requirements.txt"

FROM python:3.11-slim

# mediapipe が依存する opencv-contrib は GUI 向けビルドのため
# slim イメージに無い共有ライブラリが必要
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ARG FUNCTION_DIR
WORKDIR ${FUNCTION_DIR}

COPY --from=build-image ${FUNCTION_DIR} ${FUNCTION_DIR}

ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]
CMD [ "lambda_function.handler" ]
