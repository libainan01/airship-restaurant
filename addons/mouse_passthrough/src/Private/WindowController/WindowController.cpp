#include "Public/WindowController/WindowController.h"
#include <godot_cpp/core/class_db.hpp>
#include <wingdi.h>
#include <gdiplus.h>
#pragma comment(lib,"gdiplus.lib")

namespace godot
{
	void WindowController::InitWindow(uint64_t hwnd)
	{
		//获取窗口句柄
		Hwnd = reinterpret_cast<HWND>(hwnd);
		//创建屏幕DC
		HdcScreen = GetDC(Hwnd);
		//创建内存DC
		HdcMem = CreateCompatibleDC(HdcScreen);
	}
	void WindowController::UpdateBitmap(int width,int height, const PackedByteArray& newMask)
	{
		//锁定资源更新
		std::lock_guard<std::mutex> lock(updateMutex);

		std::vector<uint8_t> v_newMask;

		v_newMask.reserve(newMask.size());
		for (int i = 0; i < newMask.size();++i)
		{
			v_newMask.push_back(newMask[i]);
		}
		//创建新的位图
		//HbmCurrent = CreateBitmap(width, height, 1, 32, v_newMask.data());
		//if (!HbmCurrent)
		//{
		//	return;
		//}

		BITMAPINFO bmi = { 0 };
		bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
		bmi.bmiHeader.biWidth = width;
		bmi.bmiHeader.biHeight = height;
		bmi.bmiHeader.biPlanes = 1;
		bmi.bmiHeader.biBitCount = 32;
		bmi.bmiHeader.biCompression = BI_RGB;

		void* pBits = nullptr;
		
		HbmCurrent = CreateDIBitmap(HdcScreen, &bmi, DIB_RGB_COLORS, &pBits, nullptr, 0);
		if (HbmCurrent && pBits)
		{
			//复制数据并预乘Alpha
			const uint8_t* src = v_newMask.data();
			uint8_t* dst = (uint8_t*)pBits;
			for (int i = 0; i < width * height; ++i)
			{
				uint8_t a = src[3];
				dst[0] = (src[0]) / 255;
				dst[1] = (src[1]) / 255;
				dst[2] = (src[2]) / 255;
				dst[3] = 255 ;
				src += 4;
				dst += 4;
			}
		}

		//将位图绑定到内存DC
		HBITMAP oldHBM  = (HBITMAP)SelectObject(HdcMem, HbmCurrent);
		if (oldHBM) DeleteObject(oldHBM);

		//更新分层窗口
		POINT pt = { 0,0 };
		BLENDFUNCTION blend = { AC_SRC_OVER,0,255,AC_SRC_ALPHA };

		UpdateLayeredWindow(Hwnd, HdcScreen, nullptr, nullptr, HdcMem, &pt, 0, &blend, ULW_ALPHA);
	}
	void WindowController::SetWindowMousePassthrough(uint64_t hwnd, bool enable)
	{
		InitWindow(hwnd);
		LONG_PTR ex_style = GetWindowLongPtr(Hwnd, GWL_EXSTYLE);

		if (enable)
		{
			ex_style |=  WS_EX_LAYERED;
			SetWindowLongPtr(Hwnd,GWL_EXSTYLE,ex_style);

			SetWindowPos(Hwnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
		}
		else
		{
			ex_style &= ~(WS_EX_LAYERED);
			SetWindowLongPtr(Hwnd, GWL_EXSTYLE, ex_style);
			SetWindowPos(Hwnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
		}
	}

	//WindowController::~WindowController()
	//{
	//
	//}

	//void WindowController:: UpdateTransparencyMask(int width, int height, uint64_t hwnd,const std::vector<uint8_t> mask)
	//{
	//	HWND in_hwnd = reinterpret_cast<HWND>(hwnd);

	//	//获取屏幕DC
	//	HDC hdc = GetDC(in_hwnd);
	//	//创建内存DC
	//	HDC hdcMem = CreateCompatibleDC(hdc);
	//	//创建位图句柄
	//	HBITMAP hbm = CreateBitmap(width,height,1,32,mask.data());

	//	if (!hbm)
	//	{
	//		ReleaseDC(nullptr, hdc);
	//		DeleteDC(hdcMem);
	//		return;
	//	}

	//	HBITMAP hbmOld = (HBITMAP)SelectObject(hdcMem, hbm);

	//	//设置混合模式
	//	BLENDFUNCTION blend = { AC_SRC_OVER,0,255,AC_SRC_ALPHA };

	//	//更新分层窗口遮罩
	//	POINT pt = { 0,0 };
	//	UpdateLayeredWindow(in_hwnd, hdc, nullptr, &(SIZE{ width,height }), hdcMem, &pt, 0, &blend, ULW_ALPHA);

	//	SetLayeredWindowAttributes(in_hwnd, 0, 255, LWA_ALPHA);
	//	if(hbm) DeleteObject(hbm);
	//	DeleteDC(hdcMem);

	//	ReleaseDC(in_hwnd, hdc);
	//}

	void WindowController::_bind_methods()
	{
		ClassDB::bind_method(D_METHOD("SetWindowMousePassthrough", "hwnd", "enable"), &WindowController::SetWindowMousePassthrough);
		ClassDB::bind_method(D_METHOD("UpdateBitmap", "width", "height","newMask"), &WindowController::UpdateBitmap);
	}
}