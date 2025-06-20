#pragma once
#include <godot_cpp/classes/object.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <vector>
#include <Windows.h>
#include <WinUser.h>
#include <mutex>

class 

namespace godot
{
	class WindowController : public Object
	{
		GDCLASS(WindowController,Object)
	protected:
		static void _bind_methods();
	public:
		void InitWindow(uint64_t hwnd);
		void UpdateBitmap(int width,int height, const PackedByteArray& newMask);
		void SetWindowMousePassthrough(uint64_t hwnd, bool enable);

		//~WindowController();
		//void UpdateTransparencyMask(int width,int height,uint64_t hwnd,const std::vector<uint8_t> mask);
	private:
		HWND Hwnd;						//窗口句柄
		HBITMAP HbmCurrent = nullptr;	//当前显示的位图
		HDC HdcMem = nullptr;			//内存设备上下文
		HDC HdcScreen = nullptr;		//物理设备上下文

		std::mutex updateMutex; //线程锁

	};
}