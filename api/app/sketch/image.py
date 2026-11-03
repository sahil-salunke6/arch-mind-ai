"""Photo → clean, upright, binarised ink mask."""

import cv2
import numpy as np

MAX_SIDE = 1600


def load(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not an image (use JPG or PNG)")
    h, w = img.shape[:2]
    k = MAX_SIDE / max(h, w)
    return cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)


def _order(quad: np.ndarray) -> np.ndarray:
    s, d = quad.sum(1), np.diff(quad, axis=1).ravel()
    return np.array([quad[np.argmin(s)], quad[np.argmin(d)], quad[np.argmax(s)], quad[np.argmax(d)]], np.float32)


def flatten_page(img: np.ndarray) -> tuple[np.ndarray, bool]:
    """Find the sheet of paper in a phone photo and warp it flat. Returns (image, warped?)."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = gray.shape
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        quad = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        area = cv2.contourArea(quad)
        # the page must fill most of the photo but not be the photo border itself
        if len(quad) == 4 and 0.35 * w * h < area < 0.97 * w * h:
            # a sheet of paper is brighter than the table around it; a big drawn rectangle is not
            inside = np.zeros_like(gray)
            cv2.fillPoly(inside, [quad.reshape(4, 2)], 255)
            if gray[inside > 0].mean() - gray[inside == 0].mean() < 30:
                continue
            src = _order(quad.reshape(4, 2).astype(np.float32))
            tw = int(max(np.linalg.norm(src[1] - src[0]), np.linalg.norm(src[2] - src[3])))
            th = int(max(np.linalg.norm(src[3] - src[0]), np.linalg.norm(src[2] - src[1])))
            dst = np.array([[0, 0], [tw, 0], [tw, th], [0, th]], np.float32)
            warped = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (tw, th))
            k = MAX_SIDE / max(tw, th)
            return cv2.resize(warped, (round(tw * k), round(th * k))), True
    return img, False


def ink_mask(img: np.ndarray) -> np.ndarray:
    """Binary mask (255 = pen) robust to shadows and uneven lighting."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    background = cv2.medianBlur(cv2.dilate(gray, np.ones((9, 9), np.uint8)), 31)
    flat = cv2.divide(gray, background, scale=255)  # paper → ~255, ink stays dark
    _, mask = cv2.threshold(flat, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Otsu can pick up paper texture on very clean scans; require real contrast too
    mask[flat > 225] = 0
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
